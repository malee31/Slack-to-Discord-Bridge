/**
 * @file run.js is the root file that starts everything up and handles everything.
 * See the{@link module:Start| run.js documentation} for more information. (Named the Start module for documentation purposes)
 * @author Marvin Lee
 */

/**
 * The root file for the project
 * @module Start
 */

require("dotenv").config();
const DiscordManager = require("./discordManager.js");
const SlackManager = require("./slackManager.js");

// Initialize a server using the event adapter's request listener
const server = require("./fileServer.js")(SlackManager.SlackHTTPServerEventAdapter);

/**
 * Starts up the script by initializing all the necessary variables in all the JS files and completing start-up tasks
 * @returns {Promise<Array>} Returns a Promise.all with an array of all the setup and start-up functions' results (Usually undefined)
 */
function startUp() {
	console.log("============= Starting Up =============");
	console.log("============ Checking .env ============");
	// if(process.env.SLACK_DOWNLOAD_ACCESS_TOKEN_CHOICE !== "SLACK_BOT_USER_OAUTH_ACCESS_TOKEN" && process.env.SLACK_DOWNLOAD_ACCESS_TOKEN_CHOICE !== "SLACK_USER_OAUTH_ACCESS_TOKEN") {
	// 	console.log("============== Bad .env ===============");
	// 	console.error(`SLACK_DOWNLOAD_ACCESS_TOKEN_CHOICE not set to either SLACK_BOT_USER_OAUTH_ACCESS_TOKEN or SLACK_USER_OAUTH_ACCESS_TOKEN\nPlease set it properly and try again\nCurrent Value: ${process.env.SLACK_DOWNLOAD_ACCESS_TOKEN_CHOICE}`);
	// 	process.exit(1);
	// }
	console.log("============ Checked  .env ============");

	return Promise.all([
		SlackManager.start(),
		DiscordManager.start(),
		new Promise((resolve, reject) => {
			server.listen(Number(process.env.PORT) || 3000, err => {
				if(err) reject(err);
				console.log(`========== Started Port ${server.address().port} ==========`);
				resolve();
			});
		}),
	]);
}

// Starts up the logger
startUp().then(() => {
	console.log("======= All Services Started Up =======");
	SlackManager.events.on("message", DiscordManager.handleSyntaxTree.bind(DiscordManager));
	console.log("========== Start Up Complete ==========");
}).catch(err => {
	console.warn("⚠⚠ Failed Start-Up... Shutting Down ⚠⚠");
	console.error(err);
	process.exit(1);
});