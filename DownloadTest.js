const fs = require("fs");
const https = require("https");
const path = require("path");
let a = {};

function completeDownload(saveTo, downloadFromURL, headers = {}) {
	saveTo = path.resolve("C:\\Users\\Marvin\\Documents\\otherprojects\\Slack-to-Discord-Bridge\\downloads", saveTo);
	const saveFile = fs.createWriteStream(saveTo);
	return new Promise((resolve, reject) => {
		const request = https.get(downloadFromURL, {
			headers: headers
		}, response => {
			if(response.statusCode >= 300 && response.statusCode < 400) {
				a = response;
				console.log(`[${response.statusCode}] Following redirect URL to file: ${response.req.protocol}//${response.req.host}${response.headers.location}`);
				return completeDownload(saveTo, `${response.req.protocol}//${response.req.host}${response.headers.location}`, headers);
			} else if(response.statusCode !== 200) console.log(`File has a non-200 status code: [${response.statusCode}] ${response.statusMessage}`);
			console.log(`Saving File to ${saveTo}`);
			response.pipe(saveFile);
			saveFile.on('finish', async() => {
				await saveFile.close();
				resolve(saveTo);
			});
		});

		request.on("error", async err => {
			// Delete the file asynchronously on fail. Doesn't check the result
			try {
				await fs.promises.unlink(saveTo)
			} catch(unlinkErr) {
				reject(`Download Failed and Unlink Failed: ${unlinkErr}`);
			}
			reject(`Download Failed: ${err}`);
		});
	});
}