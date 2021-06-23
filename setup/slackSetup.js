const { createEventAdapter } = require("@slack/events-api");
const { WebClient } = require("@slack/web-api");
const fsMake = require("../fileServer.js");
let web, auth, slackEvents, server;

module.exports = {
	getWeb,
	getAuth,
	testOAuthToken,
	testMessaging
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

async function testMessaging(signingSecret) {
	slackEvents = createEventAdapter(signingSecret);
	return await new Promise(resolve => {
		server = fsMake(slackEvents);
		setTimeout(async () => {
			await serverClose();
			resolve("Timed out. No message was received from Slack.\nPlease Try Again");
		}, 30000);

		slackEvents.once("message", () => {
			resolve(true);
		});
		server.listen(3000);
	});
}

function serverClose() {
	return new Promise(resolve => {
		if(server) {
			server.close(() => {
				resolve();
			});
		}
		else resolve();
	});
}