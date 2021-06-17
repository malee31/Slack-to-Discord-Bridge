const { progressLog, warningLog } = require("./logger.js");
const { createEventAdapter } = require("@slack/events-api");
const { WebClient } = require("@slack/web-api");
let web, auth;

module.exports = {
	getWeb,
	getAuth,
	testOAuthToken,
	testPerms,
	setLoggingGuild,
	getLoggingGuild,
	getGuildMe
};

/**
 * Returns the WebClient object currently in use
 * Note: Returns undefined if no token has been provided to testOAuthToken() yet
 * @return {WebClient} WebClient currently in use by the slackSetup.js script
 */
function getWeb() {
	return web;
}

/**
 * Returns the auth data from the WebClient object currently in use
 * Note: Returns undefined if no *valid* token has been provided to testOAuthToken() yet
 * @return {Object} WebClient auth data from the WebClient currently in use. Retrieved from resolving WebClient.auth.test()
 */
function getAuth() {
	return auth;
}

/**
 * Tests an OAuth token to make sure it is valid
 * Note: Before trying to check with the Slack API, regex will be used to make sure the token begins with xoxb or xoxp
 * Side Effect: All future calls with the web object will be signed and authorized with this token (if valid) while the setup script is running until a new one is tested
 * The auth object will be updated with the auth data from the last token used successfully.
 * @param {string} promptResult A Slack OAuth token to test. Bot tokens usually start with "xoxb" and User tokens usually start with "xoxp"
 * @param {boolean} [bot = true] If set to true, will look for xoxb, else, will look for xoxp
 * @return {Promise<boolean|string>} Returns true if the token is valid and an error message otherwise
 */
function testOAuthToken(promptResult, bot = true) {
	let errorMessage = "";
	if(!/xox[bp]-[\da-fA-F-]+/.test(promptResult)) errorMessage = "OAuth Tokens Must Start With 'xoxp-' or 'xoxb-' Followed By Letters, Numbers, Or Dashes";
	if(bot && promptResult.startsWith("xoxp")) errorMessage = "This Token Is A User OAuth Token. A *Bot* User OAuth Token Is Currently Needed (Starts with xoxb).";
	if(!bot && promptResult.startsWith("xoxb")) errorMessage = "This Token Is A *Bot* User OAuth Token. A User OAuth Token Is Currently Needed (Starts with xoxp).";
	if(errorMessage) return Promise.resolve(errorMessage);

	const testWeb = new WebClient(promptResult);
	return testWeb.auth.test().then(authData => {
		web = testWeb;
		auth = authData;
		return true;
	}).catch(err => {
		if(err.data.error === "invalid_auth") return "The Token Is Invalid. Double Check And Try Again";
		return `Unknown Error Encountered. Token May Be Invalid:\n${err}`;
	});
}

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
	if(getGuildMe().hasPermission("ADMINISTRATOR")) {
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
	].filter(perm => !getGuildMe().hasPermission(perm));
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
	return loggingGuild.me;
}