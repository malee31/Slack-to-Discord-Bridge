if(require.main !== module) return;

require("dotenv").config();
const SlackManager = require("../slackManager.js");
const DiscordManager = require("../discordManager.js");
const testData = require("./testCases.json");
const server = require("../fileServer.js")(SlackManager.SlackHTTPServerEventAdapter);
const Set = require("prompt-set");

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
	SlackManager.events.on("message", DiscordManager.handleMessages);
	SlackManager.events.on("change", DiscordManager.handleChanges);
	SlackManager.events.on("delete", DiscordManager.handleDeletes);
	SlackManager.events.on("channel_update", DiscordManager.handleChannelUpdates);
}).then(async() => {
	const args = process.argv.slice(2);
	let selectedCases = [];
	switch(selectMode(args)) {
		case "latest":
			selectedCases.push(latestCase(args[0]));
			break;
		case "pair":
			addPairs(selectedCases, args);
			break;
		case "prompt":
			const promptedCase = await promptCase();
			selectedCases.push(promptedCase);
			break;
		default:
			throw "If you see this, emitTestData.js is broken.";
	}

	for(const testCase of selectedCases) {
		const messageType = testCase.thread_ts ? "THREAD" : "NORMAL";
		const subtype = testCase.subtype || "message";
		console.log(`EMITTING SUBTYPE: [${messageType}] ${subtype}`);

		SlackManager.SlackHTTPServerEventAdapter.emit("message", testCase);
	}

	console.log("========== Emitting Complete ==========");
	process.exit(0);
});

function selectMode(args) {
	let mode;
	switch(args.length) {
		case 0:
			mode = "prompt";
			break;
		case 1:
			mode = "latest";
			break;
		case 2:
			mode = "pair";
			break;
		default:
			if(args.length % 2 === 0) {
				mode = "pair";
			} else {
				throw "Odd number of arguments provided (>2).\nPlease enter in 0-2 arguments or 2+ in pairs";
			}
	}
	return mode;
}

function toIntWithCheck(numString) {
	let caseNum = Number(numString);

	if(isNaN(caseNum)) {
		throw `Case Number is not a Number: [${numString}]`;
	}

	return Math.floor(caseNum);
}

function latestCase(caseNumArg) {
	let caseNum = toIntWithCheck(caseNumArg);

	if(caseNum >= 10) {
		throw "Index too large (0-9 Only). Latest events only store up to 10 items.\nInput Provided: ${caseNum}";
	}

	return testData.latest[Math.floor(caseNum)];
}

function addPairs(selectedCases, pairedArgs) {
	for(let pairIndex = 0; pairIndex < pairedArgs.length; pairIndex += 2) {
		let caseType = pairedArgs[pairIndex];
		let caseNum = toIntWithCheck(pairedArgs[pairIndex + 1]);
		if(!testData[caseType]) {
			throw `Invalid Case Type: [${caseType}]`;
		}

		const cases = testData[caseType];
		if(cases.length === 0) {
			throw `There are no cases saved in case type [${caseType}].\nRun collectTestData.js and intercept one first.`;
		}

		if(cases.length <= caseNum) {
			throw `Invalid Case Index [${caseNum}]. Case type [${caseType}] only has indices 0-${cases.length - 1}`;
		}

		selectedCases.push(cases[caseNum]);
	}
}

async function promptCase() {

	const caseType = await Set.Promptlet({
		name: "caseType",
		message: "Select the type of event to emit. Latest contains the newest ones added",
		type: "list",
		choices: Object.keys(testData)
	}).execute();

	const caseNum = await Set.Promptlet({
		name: "caseType",
		message: "Select the type of event to emit. Latest contains the newest ones added",
		type: "list",
		// Note: Patch autoTrim in prompt-set. It converts the value to a type error
		autoTrim: false,
		choices: testData[caseType].map((testCase, index) => {
			return {
				name: `[${index}] Content: ${testCase.text || testCase.message?.text || "[No Details]"}`,
				value: index
			};
		})
	}).execute();

	return testData[caseType][caseNum];
}