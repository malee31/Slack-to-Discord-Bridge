if(require.main !== module) return;
require("dotenv").config();

const fs = require("fs");
const SlackHTTPServerEventAdapter = (require("@slack/events-api")).createEventAdapter(process.env.SLACK_SIGNING_SECRET);
const server = require("../fileServer.js")(SlackHTTPServerEventAdapter);
const TEST_CASE_PATH = require("path").resolve(__dirname, "testCases.json");

// testData.latest will store the last 10 events. Newest event will be at index 0
let testData = { latest: [] };
try {
	testData = JSON.parse(fs.readFileSync(TEST_CASE_PATH).toString());
} catch(e) {
	console.warn(`${e.code}: Pre-existing test data could not be read. Overwriting...\nIf this is your first time collecting test data, you can ignore this warning.`);
}

SlackHTTPServerEventAdapter.on("message", event => {
	const subtype = event.subtype || "message";
	if(!Array.isArray(testData[subtype])) {
		testData[subtype] = [];
	}
	testData[subtype].push(event);
	testData.latest.unshift(event);
	if(testData.latest.length > 10) {
		testData.latest.pop();
	}
});

process.on('SIGINT', () => {
	console.log("Saving test cases...");
	fs.writeFileSync(TEST_CASE_PATH, JSON.stringify(testData, null, 2));
	console.log("Successfully saved test cases");
	process.exit(0);
});

server.listen(process.env.PORT || 3000);