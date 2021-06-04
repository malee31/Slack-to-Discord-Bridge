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
	envConfig.DISCORD_TOKEN = await singlePromptUntilValid("Discord Bot Token: ", async promptVal => {
		try {
			await client.login(promptVal);
			console.log("Token Valid. Now Looking Up Servers");
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

	await singlePromptUntilValid("Add The Discord Bot To The Logging Server/Guild And Press Any Key To Continue");
	console.log(`The Bot Is In ${client.guilds.cache.size} Servers`);
	const guildList = client.guilds.cache.reduce((res, val) => {
		return res + `\n${val.id}: ${val.name}`;
	}, "");
	console.log(`Type The Logging Server ID From This List:${guildList}`);
	envConfig["DISCORD_GUILD_ID"] = await singlePromptUntilValid("Logging Server/Guild ID: ", val => {
		const guild = client.guilds.cache.get(val);
		if(typeof guild === "undefined") {
			console.log("Invalid Server/Guild ID. Please Select One From The List\nIf your server is not on the list, make sure to add the bot to it first.");
			console.log(`List:${guildList}`);
			return false;
		}
		console.log(`Selected Server/Guild [${guild.name}] As The Logging Server`);
		return true;
	});

	const selectedServer = client.guilds.cache.get(envConfig["DISCORD_GUILD_ID"]);
	console.log("Testing Permissions on Server");
	if(!selectedServer.me.hasPermission("ADMINISTRATOR")) await singlePromptUntilValid("The Bot Does Not Have ADMINISTRATOR Permissions.\nPlease Grant The Bot ADMINISTRATOR Permissions For A Less Painful Experience\nThen Press Any Key To Continue");
	await singlePromptUntilValid("Press Any Key To Check Permissions", () => {
		if(!selectedServer.me.hasPermission("ADMINISTRATOR")) {
			console.log("Admin Permissions Detected. Proceeding Without Additional Tests");
			return true;
		}
		console.log("ADMINISTRATOR Permissions Not Detected. Manually Checking Specific Permissions Instead");
		const failedPerms = checkPerms(selectedServer.me, [
			"SEND_MESSAGES",
			"MANAGE_MESSAGES",
			"MANAGE_CHANNELS",
			"VIEW_CHANNEL",
			"ATTACH_FILES",
			"READ_MESSAGE_HISTORY"
		]);
		if(failedPerms.length !== 0) {
			console.log(`Bot Is Missing The Following Permissions On The Server:${failedPerms.reduce((acc, val) => acc + `\n${val}`, "")}`);
			return false;
		}
		console.log("The Bot Has The Minimum Required Permissions To Run");
		return true;
	});
}

function checkPerms(clientUserMe, permList = []) {
	const failedPerms = [];
	for(const perm of permList) {
		if(!clientUserMe.hasPermission(perm)) failedPerms.push(perm);
	}
	return failedPerms;
}

async function singlePromptUntilValid(promptMessage, validityFilter, promptObj = {}) {
	promptObj = Object.assign({
		type: "text",
		name: "none",
		message: promptMessage || "Answer: "
	}, promptObj);
	do {
		prompted = (await prompts(promptObj))[promptObj.name];
		if(typeof prompted === "undefined") throw new Error("Prompt Terminated (No Value Provided)");
	} while(validityFilter && !await validityFilter(prompted))
	return prompted;
}

setup().then(() => {
	console.log("Successfully Set Up!");
}).catch(() => {
	console.error("Everything has gone wrong");
});