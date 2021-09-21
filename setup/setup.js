require("dotenv").config();
const prompts = require("prompts");
const Set = require("prompt-set");
const { progressLog, warningLog } = require("./logger.js");
const DiscordSetup = require("./discordSetup.js");
const SlackSetup = require("./slackSetup.js");
// const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const envConfig = {};

/**
 * The entry setup function
 * @async
 */
async function setup() {
	progressLog("Beginning Setup Process");
	await fsSetup();
	await discordSetup();
	await slackSetup();
	progressLog("Now Connecting To Slack\nAttempting To Listen To Messages");
	// TODO: Test file downloading and message reading

	// End Messages
	warningLog("Note: Database functions have not been tested. Assume the database to be fine if the first message sends successfully")
	progressLog("Saving Data To .env File");
	saveEnv();
	progressLog("Successfully Saved!");
}

/**
 * Wrapper function for prompts that sets some defaults for the prompt object and only returns the response instead of an object
 * @param {Object} promptObj Object passed to the prompts function
 * @param {Object} [options] Options passed to the prompts function
 * @return {Promise<string|string[]>} Prompt response in the form of a string or array of strings depending on the prompt type
 */
function ask(promptObj, options) {
	promptObj.name = "none";
	promptObj.type = promptObj.type || "text";
	return prompts(promptObj, options).then(result => result["none"]);
}

/**
 * A wrapper function for prompts that creates a 'Press Any Key To Continue' type prompt until a condition is fulfilled
 * @async
 * @param {string} message Message to display for the 'Press Any Key To Continue' prompt
 * @param {function} [validate] Validation function that returns a string to display as an error on fail and true on success. Prompt will loop forever until true is returned
 */
async function anyKey(message, validate) {
	await prompts({
		type: "invisible",
		name: "none",
		message,
		validate
	});
}

/**
 * All prompts and setup steps for the local file server
 * @async
 */
async function fsSetup() {
	progressLog("Now Configuring File Server Preferences");
	warningLog("Files too large to send to Discord are saved on this device.\nEnabling File Server allows the files to be shared using a link instead but anyone who guesses the link will be able to view them too.\n(Note: Files uploaded to Discord are all technically public too but have longer and more specific URLs that make it harder to guess)");
	envConfig.DISABLE_FILE_SERVER = await ask({
		type: "confirm",
		message: "Enable File Server: ",
		initial: true
	}) ? "FALSE" : "TRUE";

	if(envConfig.DISABLE_FILE_SERVER === "FALSE") {
		warningLog("Enabling File List will show the links to every file saved on the file server, making it easily accessible and PUBLIC to EVERYONE including random people");
		envConfig.DISABLE_FILE_SERVER_LIST = await ask({
			type: "confirm",
			message: "Enable File List On File Server: ",
			initial: true
		}) ? "FALSE" : "TRUE";

		envConfig.SERVER_URL = await ask({
			message: "Server URL: ",
			validate: promptResult => /https?:\/\/.+[^\/]$/.test(promptResult) || "Server URL must start with http:// or https://. Do not end the URL with a /"
		});
	}
}

/**
 * All prompts and setup steps for Discord
 * @async
 */
async function discordSetup() {
	// Discord Setup Prompts
	console.clear();
	progressLog("Now Setting Up Discord Portion");
	envConfig.DISCORD_TOKEN = await ask({
		message: "Enter In Your Discord Bot Token (You can find this in the Discord Developer Portal): ",
		validate: DiscordSetup.testToken
	});
	progressLog("Discord Bot Token Valid");
	await anyKey("Add The Discord Bot To The Logging Server/Guild And Press Enter To Continue");
	progressLog(`The Bot Is In ${DiscordSetup.client.guilds.cache.size} Servers`);
	envConfig.DISCORD_GUILD_ID = await ask({
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
	await anyKey("Press Enter To Check Permissions", DiscordSetup.testPerms);
	progressLog("Discord Bot Has Been Successfully Set Up");
}

/**
 * All prompts and setup steps for Slack
 * @async
 */
async function slackSetup() {
	console.clear();
	// Default
	envConfig.SLACK_DOWNLOAD_ACCESS_TOKEN_CHOICE = "SLACK_BOT_USER_OAUTH_ACCESS_TOKEN";
	progressLog("Now Setting Up Slack App Portion");
	progressLog("Go to the Slack Developer page for the Slack App");
	envConfig.SLACK_USER_OAUTH_ACCESS_TOKEN = await ask({
		message: "Enter In The Slack User OAuth Access Token (Starts with 'xoxp-'): ",
		validate: promptResult => SlackSetup.testOAuthToken(promptResult, false)
	});
	progressLog(`Using User OAuth Token from [${SlackSetup.getAuth().user}] for Workspace [${SlackSetup.getAuth().team}]`);
	const team = { name: SlackSetup.getAuth().team, id: SlackSetup.getAuth().team_id };
	envConfig.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN = await ask({
		message: "Enter In The Slack Bot User OAuth Access Token (Starts with 'xoxb-'): ",
		validate: promptResult => SlackSetup.testOAuthToken(promptResult, true)
	});
	progressLog(`Using Bot User OAuth Token from [${SlackSetup.getAuth().user}] for Workspace [${SlackSetup.getAuth().team}]`);
	if(SlackSetup.getAuth().team_id !== team.id) warningLog(`WARNING: Workspaces Don't Match!\nThe User OAuth Token Is For [${team.name}] While The Bot User OAuth Token Is For [${SlackSetup.getAuth().team}]\nFix this in the .env file later. As long as the Bot User OAuth token is correct, there is a chance that this will not affect the code (Worst case: Files will not be downloaded from Slack and the default png will be shown instead)`);

	let validSigningSecret = false;
	while(validSigningSecret !== true) {
		if(typeof validSigningSecret === "string") warningLog(validSigningSecret);
		envConfig.SLACK_SIGNING_SECRET = await ask({
			message: "Enter In The Signing Secret (Found on the main page): ",
			validate: promptResult => /[\da-fA-F]+/.test(promptResult) || "The Signing Secret Must Only Contain Letters And Numbers"
		});
		progressLog(`Signing with ${envConfig.SLACK_SIGNING_SECRET}\nSend a message to a Slack channel to continue...\n(Time Limit: 30 Seconds)`);
		validSigningSecret = await SlackSetup.testMessaging(envConfig.SLACK_SIGNING_SECRET);
	}
	progressLog("Will Now Attempt To Download A File From Slack With Bot Token. Send Any Image To Slack To Continue...");
	await SlackSetup.testDownload(envConfig.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN);
	await anyKey("Double Check And Press Any Key To Finish Setup");
}

/**
 * Serializes environment variables to the .env file
 * Will overwrite pre-existing .env files
 * Is synchronous
 */
function saveEnv() {
	let content = "";
	for(const key in envConfig) {
		if(content !== "") content += "\n";
		content += `${key}=${envConfig[key].includes(" ") ? `"${envConfig[key]}"` : envConfig[key]}`;
	}
	try {
		fs.writeFileSync(path.resolve(__dirname, "../.env"), content);
	} catch(e) {
		console.error(`Unable to Save to File: ${e}`);
		process.exit(1);
	}
}

// Triggers the entire setup process
setup().then(() => {
	console.log("Successfully Set Up!");
	process.exit(0);
}).catch(err => {
	console.error(`Everything has gone wrong\nSetup incomplete, please find the problem and try again\n${err}`);
	process.exit(1);
});