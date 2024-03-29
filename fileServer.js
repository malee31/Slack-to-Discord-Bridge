const fileManager = require("./fileManager.js");
const mime = require("mime-types");
const http = require("http");
const path = require("path");
const fs = require("fs");

/**
 * An adapter for Slack’s Events API.
 * @external SlackEventAdapter
 * @see https://slack.dev/node-slack-sdk/reference/events-api
 */

/**
 * Creates the simple file server for downloads and adds in the Slack events listener to the server
 * @param {SlackEventAdapter} slackEvents The event adapter for Slack from {@link https://slack.dev/node-slack-sdk/reference/events-api|require("@slack/events-api").createEventAdapter}
 * @module fileServer
 */
module.exports = fsMake;

function fsMake(slackEvents) {
	return http.createServer((req, res) => {
		// Default Slack endpoint for all Slack events
		if(req.url === "/slack/events") {
			slackEvents.requestListener()(req, res);
			return;
		}

		const fileName = decodeURIComponent(req.url.split("?")[0]);
		const filePath = getRequestedPath(fileName, req, res);

		if(!filePath) return;
		if(filePath === fileManager.DOWNLOADS_FOLDER) {
			showFileList(filePath, res);
			return;
		}

		fs.readFile(filePath, (err, data) => {
			if(err) {
				console.warn(`Error reading file from downloads: ${err}`);
				res.writeHead(200, { "Content-Type": "text/plain" });
				res.write(`Error reading file from downloads (${filePath}): \n${err}`);
				res.end();
				return;
			}
			const contentType = mime.lookup(filePath);
			res.writeHead(200, {
				"Content-Type": contentType ?? false,
				"Content-Disposition": req.url.toLowerCase().split("?")[1]?.includes("download") ? "attachment" : "inline"
			});
			res.end(data, "UTF-8");
		});
	});
}

/**
 * Takes in the file path and request data and resolves it to a file path in the downloads folder<br>
 * May be disabled with environment variables
 * @param {string} fileName Name of the file. Originates from req.url so it must start with a /
 * @param {IncomingMessage} req Request object from http or any other server request
 * @param {ServerResponse} res Response object from http or any other server request
 * @return {string|boolean} Returns the absolute path to a file in the downloads folder or false if access should be denied
 */
function getRequestedPath(fileName, req, res) {
	const filePath = path.resolve(fileManager.DOWNLOADS_FOLDER, "." + fileName);
	console.log(`[${new Date().toLocaleString()}] Accessing ${filePath} from ${req.url}`);
	if(!filePath.startsWith(fileManager.DOWNLOADS_FOLDER)) {
		console.warn(`Attempt to access ${filePath} detected and denied`);
		return false;
	}

	if(process.env.DISABLE_FILE_SERVER?.trim().toLowerCase() === "true") {
		console.warn("File Server is Disabled. File Request Denied");
		res.writeHead(500, { "Content-Type": "text/plain" });
		res.write(`The file server is set to private and disabled.\nYour files are most likely still stored on the server so ask the server owner for it if you need it!`);
		res.end();
		return false;
	}

	return filePath;
}

/**
 * Lists the names of all files in the downloads folder. Can be disabled with environment variables.
 * @param {string} filePath Absolute path to a file in the downloads folder. May be a file that does not exist
 * @param {ServerResponse} res Response object from http or any other server request
 */
function showFileList(filePath, res) {
	if(process.env.DISABLE_FILE_SERVER_LIST?.trim().toLowerCase() !== "true") {
		fs.readdir(filePath, (err, files) => {
			if(err) {
				console.warn("Error Reading Downloads Folder");
				res.writeHead(500, { "Content-Type": "text/plain" });
				res.write(`Error Reading Downloads Folder: \n${err}`);
				res.end();
				return;
			}

			res.writeHead(200, { "Content-Type": "text/plain" });
			res.write(`Download Folder Contents:\n`);
			files.forEach(file => {
				res.write(`${file}\n`);
			});
			res.end();
		});
	} else {
		res.writeHead(200, { "Content-Type": "text/plain" });
		res.write("List of files stored on the server will not be listed because DISABLE_FILE_SERVER_LIST is set to TRUE.\nEach specific file is still accessible through their respective urls");
		res.end();
	}
}