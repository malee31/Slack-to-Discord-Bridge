require("dotenv").config();
const prompts = require("prompts");
const { progressLog, warningLog } = require("./logger.js");
const DiscordSetup = require("./discordSetup");
const envConfig = {};

async function setup() {
	progressLog("Beginning Setup Process");

	// Discord Setup Prompts
	progressLog("Testing Discord Token and Permissions");
	envConfig.DISCORD_TOKEN = await namelessPrompt({
		type: "text",
		message: "Enter In Your Discord Bot Token: ",
		hint: "You can find this in the Discord Developer Portal",
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

setup().then(() => {
	console.log("Successfully Set Up!");
}).catch(err => {
	console.error(`Everything has gone wrong\n${err}`);
	process.exit(1);
});