require("dotenv").config();
const prompts = require("prompts");
const Discord = require("discord.js");
const client = new Discord.Client();
let prompted = {};
const envConfig = {};

async function setup() {
	console.log("Beginning Setup Process");
	console.log("Testing Discord Token and Permissions");
	console.log("Testing Discord Bot Token");
	envConfig.DISCORD_TOKEN = await singlePromptUntilValid({
		type: "text",
		name: "DISCORD_TOKEN",
		message: "Discord Bot Token: "
	}, async promptVal => {
		try {
			await client.login(promptVal);
			console.log("Token Valid. Now Testing Permissions");
			return true;
		} catch(err) {
			if(err.code === "TOKEN_INVALID") {
				console.warn("Invalid Discord Bot Token. Try again");
				return false;
			} else {
				console.error(`Something went wrong testing the token. Share this message for details:\n%{err}`);
				console.warn("Assuming the token is correct and proceeding to next step. If the next step doesn't work either, the assumption is wrong.");
				return true;
			}
		}
	});
}

async function singlePromptUntilValid(promptObj, validityFilter) {
	let firstRun = true;
	while(firstRun || !await validityFilter(prompted)) {
		firstRun = false;
		prompted = (await prompts(promptObj))[promptObj.name];
		if(typeof prompted === "undefined") throw new Error("Prompt Terminated (No Value Provided)");
	}
	return prompted;
}

setup().then(() => {
	console.log("Successfully Set Up!");
}).catch(() => {
	console.error("Everything has gone wrong");
});