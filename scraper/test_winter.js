const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', async msg => {
    const args = [];
    for (const arg of msg.args()) {
      try {
        const val = await arg.jsonValue();
        args.push(typeof val === 'object' ? JSON.stringify(val, null, 2) : val);
      } catch (e) {
        args.push('[complex object]');
      }
    }
    console.log('PAGE LOG:', ...args);
  });

  try {
    console.log("Navigating to index.html...");
    await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle2' });

    console.log("Waiting for rawDatabase...");
    await page.waitForFunction(() => window.rawDatabase !== null, { timeout: 10000 });

    console.log("Selecting Winter 2027 term...");
    await page.evaluate(() => {
      // Winter 2027 term code is '202710'
      window.selectTerm('202710');
    });

    console.log("Uploading file...");
    const fileInput = await page.$('#treeUploadInput');
    await fileInput.uploadFile('C:\\Users\\jabur\\OneDrive\\Desktop\\CSE-24-25.pdf');

    console.log("Waiting for processing...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Select Year 3 and Winter
    console.log("Selecting 3rd Year Winter in dropdowns...");
    await page.evaluate(() => {
      document.getElementById('treeYearSelect').value = '3';
      document.getElementById('treeSemSelect').value = 'W';
      window.renderTree();
    });

    const noteText = await page.$eval('#treeNote', el => el.textContent);
    console.log("UI treeNote text:", noteText);

    const gridHtml = await page.$eval('#treeCourseGrid', el => el.innerHTML);
    console.log("Grid HTML content:", gridHtml);

    const courseTree = await page.evaluate(() => {
      return COURSE_TREE['PDF'];
    });
    console.log("COURSE_TREE['PDF'] structure for Year 3:", JSON.stringify(courseTree.years[3], null, 2));

  } catch (err) {
    console.error("Error during test:", err);
  } finally {
    await browser.close();
  }
})();
