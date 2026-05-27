const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://central.carleton.ca/prod/bwysched.p_select_term?wsea_code=EXT';

const SUBJECT_CODES = [
    "ACCS", "ACCT", "AERO", "AFRI", "ASLA", "ANTH", "ALDS", "ACSE",
    "ARCT", "ARCY", "ARCS", "ARCC", "ARCN", "ARCH", "ARTH", "BIOC",
    "BIOL", "BIOM", "BLDG", "BUSI", "CDNS", "CIED", "CHEM", "CHST",
    "CHIN", "CIVE", "CIVJ", "CLCV", "CLIM", "COOP", "CGSC", "CCDP",
    "COMS", "COMP", "CRCJ", "CRST", "CLMD", "CURA", "CYBR", "DATA",
    "DIGH", "DBST", "ESPW", "ERTH", "ECON", "EACJ", "ELEC", "ECMP",
    "ECOR", "EGEN", "EWEX", "ENGL", "ESLA", "EACH", "ENVJ", "ENVE",
    "ENSC", "ENST", "EPAF", "EURR", "FILM", "FINA", "FYSM", "FOOD",
    "FREN", "FINS", "GEOG", "GEOM", "GERM", "GINS", "GREK", "HLTH",
    "HIST", "HRSJ", "HCIN", "HUMS", "IESP", "INDG", "IDES", "IRM",
    "ITIS", "BIT", "ITEC", "IPIS", "IMD", "ISAP", "IPAF", "INAF",
    "IBUS", "ITAL", "JAPA", "JOUR", "KORE", "LANG", "LATN", "LACS",
    "LAWS", "LING", "MGMT", "MKTG", "MATH", "MAAJ", "MECH", "MAAE",
    "MPAD", "MEMS", "MGDS", "MUSI", "NSCI", "NET", "NEUR", "NURS",
    "OSS", "PANL", "PHIL", "PHYS", "PHYJ", "PECO", "POLM", "PSCI",
    "PSYC", "PADM", "PAPM", "RELI", "RUSS", "SXST", "SOWK", "SOCI",
    "SPAN", "STAT", "STGY", "SREE", "SERG", "SYSC", "TEAL", "TSES",
    "TIMG", "TOMS", "WGST"
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function parseResultsHTML(html) {
    const $ = cheerio.load(html);
    const sections = [];

    $('tr[bgcolor]').each((i, row) => {
        const bg = $(row).attr('bgcolor');
        if (bg.toLowerCase() !== '#c0c0c0' && bg.toLowerCase() !== '#dcdcdc') return;

        const cols = $(row).find('td');
        if (cols.length <= 10) return;

        try {
            const status = $(cols[0]).text().trim();
            const crn = $(cols[2]).text().trim();
            const name = $(cols[3]).text().trim();
            const sectionLetter = $(cols[4]).text().trim();
            const title = $(cols[5]).text().trim();
            const credits = $(cols[6]).text().trim();
            const scheduleType = $(cols[7]).text().trim();
            const instructor = $(cols[10]).text().trim();

            if (!name || !crn) return;

            const timeRow = $(row).next();
            if (!timeRow.length) return;
            const detailText = timeRow.text();

            const dateMatch = detailText.match(/Meeting Date:\s*(.+?)\s*Days:/);
            const dateRange = dateMatch ? dateMatch[1].trim() : "";

            const dayMatch = detailText.match(/Days:\s*(.*?)\s*Time:/);
            const daysRaw = dayMatch ? dayMatch[1].trim() : "";

            const timeMatch = detailText.match(/Time:\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
            const startTime = timeMatch ? timeMatch[1] : "";
            const endTime = timeMatch ? timeMatch[2] : "";

            const bldgMatch = detailText.match(/Bldg:\s*(.*?)\s*Room:/);
            const building = bldgMatch ? bldgMatch[1].trim() : "";
            const roomMatch = detailText.match(/Room:\s*(\S+)/);
            const room = roomMatch ? roomMatch[1].trim() : "";

            const dayMap = {
                'monday': 'M', 'mon': 'M',
                'tuesday': 'T', 'tue': 'T',
                'wednesday': 'W', 'wed': 'W',
                'thursday': 'R', 'thu': 'R',
                'friday': 'F', 'fri': 'F'
            };

            const days = [];
            if (daysRaw) {
                daysRaw.split(/\s+/).forEach(token => {
                    const code = dayMap[token.toLowerCase()];
                    if (code) days.push(code);
                });
            }

            sections.push({
                name, title, section: sectionLetter, crn, type: scheduleType,
                instructor, days, startTime, endTime, dateRange, building, room, status, credits
            });
        } catch (e) {
            console.error("Error parsing row:", e);
        }
    });

    return sections;
}

async function scrapeTerm(page, termCode, termName) {
    console.log(`\n============================================================`);
    console.log(`  Scraping: ${termName} (${termCode})`);
    console.log(`============================================================`);

    const allSections = [];

    for (let i = 0; i < SUBJECT_CODES.length; i++) {
        const subj = SUBJECT_CODES[i];
        process.stdout.write(`  → [${(i + 1).toString().padStart(3, ' ')}/${SUBJECT_CODES.length}] Searching ${subj}... `);

        try {
            // 1. Go to Term Selection
            await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

            // 2. Select Term
            await page.select('select[name="term_code"]', termCode);
            await Promise.all([
                page.click('input[type="submit"][value="Proceed to Search"]'),
                page.waitForNavigation({ waitUntil: 'networkidle0' })
            ]);

            // 3. Select Subject
            await page.waitForSelector('select[name="sel_subj"]');

            // Deselect all options first in browser context
            await page.evaluate(() => {
                const select = document.querySelector('select[name="sel_subj"]');
                if (select) {
                    for (let j = 0; j < select.options.length; j++) {
                        select.options[j].selected = false;
                    }
                }
            });

            // Select the specific subject
            await page.select('select[name="sel_subj"]', subj);

            // 4. Hit Search
            await Promise.all([
                page.click('input[type="submit"][value="Search"]'),
                page.waitForNavigation({ waitUntil: 'networkidle0' })
            ]);

            // 5. Get Results HTML
            const html = await page.content();
            const sections = await parseResultsHTML(html);

            allSections.push(...sections);
            console.log(`found ${sections.length} sections`);

        } catch (e) {
            console.log(`ERROR: ${e.message}`);
        }

        await sleep(300); // Be polite to the server
    }

    console.log(`\n  Total sections scraped: ${allSections.length}`);
    return allSections;
}

function organizeCourses(sections) {
    const courses = {};
    for (const sec of sections) {
        if (!courses[sec.name]) courses[sec.name] = [];
        courses[sec.name].push(sec);
    }
    return courses;
}

async function main() {
    const args = process.argv.slice(2);
    let specificTerm = null;
    if (args.includes('--term')) {
        specificTerm = args[args.indexOf('--term') + 1];
    }

    console.log("Launching headless browser...");
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // Fake a real user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

    // Get available terms
    const terms = await page.evaluate(() => {
        const opts = Array.from(document.querySelectorAll('select[name="term_code"] option'));
        return opts
            .map(o => ({ code: o.value, name: o.textContent.trim() }))
            .filter(o => o.code && o.code.length > 0);
    });

    if (!terms.length) {
        console.error("ERROR: No terms found on selection page!");
        process.exit(1);
    }

    const termsToScrape = specificTerm
        ? terms.filter(t => t.code === specificTerm)
        : terms;

    console.log(`Found ${termsToScrape.length} terms to scrape.`);

    const allData = {};

    for (const term of termsToScrape) {
        const sections = await scrapeTerm(page, term.code, term.name);
        const courses = organizeCourses(sections);

        allData[term.code] = {
            term_code: term.code,
            term_name: term.name,
            scraped_at: new Date().toISOString(),
            course_count: Object.keys(courses).length,
            section_count: sections.length,
            courses: courses
        };
    }

    await browser.close();

    // Write output
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const outPath = path.join(dataDir, 'courses.json');
    fs.writeFileSync(outPath, JSON.stringify(allData, null, 2), 'utf8');

    console.log(`\n✓ Data written to ${outPath}`);
    for (const tc of Object.keys(allData)) {
        console.log(`  ${allData[tc].term_name}: ${allData[tc].course_count} courses, ${allData[tc].section_count} sections`);
    }
}

main().catch(console.error);
