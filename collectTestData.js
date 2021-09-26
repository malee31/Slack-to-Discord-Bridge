// For quickly collecting JSON to test code with
require("dotenv").config();
const SlackManager = require("./slackManager.js");
const DiscordManager = require("./discordManager.js");
const testData = require("./testCases.json");

// Run with `node collectTestData.js > testCases.json` or `node collectTestData.js emit <test case number to emit>`
if(require.main === module && process.argv[2] !== "emit") {
	console.log("[");
	const SlackHTTPServerEventAdapter = (require("@slack/events-api")).createEventAdapter(process.env.SLACK_SIGNING_SECRET);
	const server = require("./fileServer.js")(SlackHTTPServerEventAdapter);
	server.listen(3000);
	SlackHTTPServerEventAdapter.on("message", event => {
		console.log("\t" + JSON.stringify(event) + ",");
	});
	// Note: File must be manually fixed by adding a ] at the end
} else {
	const DiscordManager = require("./discordManager.js");
	const SlackManager = require("./slackManager.js");
	const server = require("./fileServer.js")(SlackManager.SlackHTTPServerEventAdapter);

	Promise.all([
		SlackManager.start(),
		DiscordManager.start(),
		new Promise((resolve, reject) => {
			server.listen(Number(process.env.PORT) || 3000, err => {
				if(err) reject(err);
				console.log(`========== Started Port ${server.address().port} ==========`);
				resolve();
			});
		}),
	]).then(() => {
		const testData = require("./testCases.json")[process.argv[3]];
		console.log(testData);
		console.log(`EMITTED: ${testData.subtype}`);
		SlackManager.events.on("message", DiscordManager.handleSyntaxTree.bind(DiscordManager));
		SlackManager.SlackHTTPServerEventAdapter.emit("message", testData);
	})
}