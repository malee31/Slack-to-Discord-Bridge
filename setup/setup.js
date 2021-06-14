require("dotenv").config();
const prompts = require("prompts");
const { progressLog, warningLog } = require("./logger.js");
const DiscordSetup = require("./discordSetup");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const envConfig = {};

async function setup() {
	progressLog("Beginning Setup Process");

	// Discord Setup Prompts
	progressLog("Testing Discord Token and Permissions");
	envConfig.DISCORD_TOKEN = await namelessPrompt({
		type: "text",
		message: "Enter In Your Discord Bot Token (You can find this in the Discord Developer Portal): ",
		validate: DiscordSetup.testToken
	});
	progressLog("Discord Bot Token Valid");
	await anyKeyPrompt("Add The Discord Bot To The Logging Server/Guild And Press Enter To Continue");
	progressLog(`The Bot Is In ${DiscordSetup.client.guilds.cache.size} Servers`);
	envConfig.DISCORD_GUILD_ID = await namelessPrompt({
		type: "select",
		message: "Logging Server/Guild ID: ",
		hint: "Use the arrows to select the target server from this list. Enter once if they do not work.",
		initial: 0,
		choices: DiscordSetup.client.guilds.cache.map(guild => {
			return {
				title: `[${guild.id}] ${guild.name}`,
				value: guild.id
			};
		})
	});
	DiscordSetup.setLoggingGuild(envConfig.DISCORD_GUILD_ID);
	progressLog(`Selected [${DiscordSetup.getLoggingGuild().name}] As The Logging Server`);
	progressLog("Testing Permissions on Server");
	if(!DiscordSetup.getGuildMe().hasPermission("ADMINISTRATOR")) warningLog("The Bot Does Not Have ADMINISTRATOR Permissions.\nGrant The Bot ADMINISTRATOR Permissions Before The Next Step For An Easier Setup");
	await anyKeyPrompt("Press Enter To Check Permissions", DiscordSetup.testPerms);
	progressLog("Discord Bot Has Been Successfully Set Up");


	// Slack Setup Prompts
	progressLog("Go to the Slack Developer page for the Slack App");
	envConfig.SLACK_SIGNING_SECRET = await namelessPrompt({
		type: "text",
		message: "Enter In The Signing Secret (Found on the main page): ",
		validate: promptResult => /[\da-fA-F]+/.test(promptResult) || "The Signing Secret Must Only Contain Letters And Numbers"
	});
	envConfig.SLACK_USER_OAUTH_ACCESS_TOKEN = await namelessPrompt({
		type: "text",
		message: "Enter In The Slack User OAuth Access Token (Starts with 'xoxp-'): ",
		validate: promptResult => /xoxp-[\da-fA-F-]+/.test(promptResult) || "The Token Must Start With 'xoxp-' And Be Followed By Letters, Numbers, Or Dashes"
	});
	envConfig.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN = await namelessPrompt({
		type: "text",
		message: "Enter In The Slack Bot User OAuth Access Token (Starts with 'xoxb-'): ",
		validate: promptResult => /xoxb-[\da-fA-F-]+/.test(promptResult) || "The Token Must Start With 'xoxb-' And Be Followed By Letters, Numbers, Or Dashes"
	});

	progressLog("Now Configuring File Server Preferences");
	warningLog("Files too large to send to Discord are saved on this device.\nEnabling File Server allows the files to be shared using a link instead but anyone who guesses the link will be able to view them too.\n(Note: Files uploaded to Discord are all technically public too but have longer and more specific URLs that make it harder to guess)");
	envConfig.DISABLE_FILE_SERVER = await namelessPrompt({
		type: "confirm",
		message: "Enable File Server: ",
		initial: true
	}) ? "FALSE" : "TRUE";

	if(envConfig.DISABLE_FILE_SERVER === "FALSE") {
		warningLog("Enabling File List will show the links to every file saved on the file server, making it easily accessible and PUBLIC to EVERYONE including random people");
		envConfig.DISABLE_FILE_SERVER_LIST = await namelessPrompt({
			type: "confirm",
			message: "Enable File List On File Server: ",
			initial: true
		}) ? "FALSE" : "TRUE";

		envConfig.SERVER_URL = await namelessPrompt({
			type: "text",
			message: "Server URL: ",
			validate: promptResult => /https?:\/\/.+[^\/]$/.test(promptResult) || "Server URL must start with http:// or https://. Do not end the URL with a /"
		});
	}


	// End Messages
	warningLog("Note: Database functions have not been tested. Assume the database to be fine if the first message sends successfully")
	progressLog("Saving Data To .env File");
	saveEnv();
	progressLog("Successfully Saved!");
}

function namelessPrompt(promptObj, options) {
	promptObj.name = "none";
	return prompts(promptObj, options).then(result => result["none"]);
}

function anyKeyPrompt(message, validate) {
	return prompts({
		type: "invisible",
		name: "none",
		message,
		validate
	});
}

function saveEnv() {
	let content = "";
	for(const key in envConfig) {
		if(content !== "") content += "\n";
		content += `${key}=${envConfig[key].includes(" ") ? `"${envConfig[key]}"` : envConfig[key]}`;
	}
	try {
		fs.writeFileSync(path.resolve(__dirname, "../.env"), content);
	} catch (e) {
		console.error(`Unable to Save to File ${e}`);
		process.exit(1);
	}
}

setup().then(() => {
	console.log("Successfully Set Up!");
	process.exit(0);
}).catch(err => {
	console.error(`Everything has gone wrong\n${err}`);
	process.exit(1);
});