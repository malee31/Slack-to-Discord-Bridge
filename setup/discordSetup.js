const { progressLog, warningLog } = require("./logger.js");
const Discord = require("discord.js");
const client = new Discord.Client({ intents: require("../Intents.js") });
let loggingGuild;

module.exports = {
	client,
	testToken,
	testPerms,
	setLoggingGuild,
	getLoggingGuild,
	getGuildMe
};

/**
 * Tests the token to make sure it works
 * Side Effect: The client object will be logged in with the token after the function finishes.
 * @async
 * @param {string} promptResult The Discord token value to test
 * @return {Promise<boolean|string>} Returns true if TOKEN_INVALID error is not received. Returns error message otherwise
 */
async function testToken(promptResult) {
	try {
		await client.login(promptResult);
		console.log("Token Valid. Now Looking Up Servers");
		return true;
	} catch(err) {
		if(err.code === "TOKEN_INVALID") {
			return "Invalid Discord Bot Token. Try again";
		} else {
			console.error(`Something went wrong testing the token. Share this message for details:\n${err}`);
			console.warn("Assuming the token is correct and proceeding to next step. If the next step doesn't work either, the assumption is wrong.");
			return true;
		}
	}
}

async function testPerms() {
	if(getGuildMe().permissions.has("ADMINISTRATOR")) {
		progressLog("Admin Permissions Detected. Proceeding Without Additional Tests");
		return true;
	}
	warningLog("ADMINISTRATOR Permissions Not Detected. Manually Checking Specific Permissions Instead");
	const failedPerms = [
		"SEND_MESSAGES",
		"MANAGE_MESSAGES",
		"MANAGE_CHANNELS",
		"VIEW_CHANNEL",
		"ATTACH_FILES",
		"READ_MESSAGE_HISTORY"
	].filter(perm => !getGuildMe().permissions.has(perm));
	if(failedPerms.length !== 0) {
		return `The Following Permissions Are Missing. Grant Admin Or Those Permissions And Press Enter To Check Again: [${failedPerms.join(", ")}]`;
	}
	progressLog("The Bot Has The Minimum Required Permissions To Run");
	return true;
}

function setLoggingGuild(guildID) {
	loggingGuild = client.guilds.cache.get(guildID);
}

function getLoggingGuild() {
	if(loggingGuild === undefined) throw new Error("Logging Guild Not Set");
	return loggingGuild;
}

function getGuildMe() {
	if(loggingGuild === undefined) throw new Error("Logging Guild Not Set");
	console.log(loggingGuild.me);
	return loggingGuild.me;
}