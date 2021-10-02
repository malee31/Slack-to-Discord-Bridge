if(require.main !== module) return;

require("dotenv").config();
const SlackManager = require("../slackManager.js");
const DiscordManager = require("../discordManager.js");
const testData = require("./testCases.json");
const server = require("../fileServer.js")(SlackManager.SlackHTTPServerEventAdapter);

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
	const emitWhich = process.argv.slice(2);
	const enumerateFirstArg = Number(emitWhich[0]);
	let selectedCase;

	if(!isNaN(enumerateFirstArg)) {
		if(enumerateFirstArg >= 10) throw "Index too large for latest events. Use 0-9 or specify an event type";
		selectedCase = testData.latest[enumerateFirstArg];
	} else {
		selectedCase = testData[emitWhich[0]][Number(emitWhich[1])];
	}
	console.log(`EMITTING: ${testData.subtype}`);
	SlackManager.events.on("message", DiscordManager.handleMessages);
	SlackManager.events.on("change", DiscordManager.handleChanges);
	SlackManager.events.on("delete", DiscordManager.handleDeletes);
	SlackManager.events.on("channel_update", DiscordManager.handleChannelUpdates);
	SlackManager.SlackHTTPServerEventAdapter.emit("message", selectedCase);
});