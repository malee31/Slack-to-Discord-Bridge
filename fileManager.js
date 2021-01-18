const https = require("https");
const path = require("path");
const fs = require("fs");

const DOWNLOADS_FOLDER = path.resolve(__dirname, "downloads");
// Arbitrary. Used as the max number of attempts getValidFileName has for finding an available path to download a file to
// If the program doesn't crash or reject in-between the download and the deletion, this will most likely never be reached if kept over 10
const FILE_NAME_ITERATOR_LIMIT = 200;
const pendingDownloads = [];

/**
 * Handles downloading and deleting files from folders (Especially the designated downloads folder)
 * @module fileManager
 */
module.exports = {
	/**
	 * @constant {string} DOWNLOADS_FOLDER Absolute path to the folder for downloaded files
	 */
	DOWNLOADS_FOLDER: DOWNLOADS_FOLDER,
	/**
	 * Downloads a file from a Slack file object. File name may change if a file by the same name already exists according to {@link getValidFileName}
	 * @async
	 * @param {Object} fileObj Slack file details object (Found in event.files[])
	 * @param {string} [fileName] Name for file (Defaults to the name provided by Slack)
	 * @returns {Promise<{path: string, extension: (string|*), original: ({name}|*), size: *, name, title, storedAs: string}>} An object containing details on where the file is, what is is called, the original Slack file object, and more
	 */
	fileDownload: async(fileObj, fileName) => {
		fileName = (fileName || fileObj.name).replace(/\//g, " - ");
		let split = fileName.split(".");
		let fileFormat = {extension: fileName.includes(".") ? split.pop() : "", name: split.join(".")};
		fileName = await getValidFileName(DOWNLOADS_FOLDER, fileFormat.name, fileFormat.extension);

		let finalDownloadPath = path.resolve(DOWNLOADS_FOLDER, fileName)
		pendingDownloads.push(finalDownloadPath);

		await completeDownload(finalDownloadPath, fileObj["url_private_download"], {
			Authorization: `Bearer ${process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN}`
		});

		// TODO: There is probably a way to get it from the headers while downloading the file
		const downloadSize = await fileSize(finalDownloadPath);

		return {
			name: fileObj.name,
			title: fileObj.title,
			path: finalDownloadPath,
			storedAs: fileName,
			extension: fileFormat.extension,
			size: downloadSize,
			original: fileObj
		};
	},

	/**
	 * Deletes a file from the downloads folder specifically
	 * @async
	 * @param {string} fileName Name of file to delete from the downloads folder
	 * @return {Promise<void>} Returns the promise from fs.promises.unlink
	 */
	fileDelete: async fileName => {
		let fileDeletePath = path.resolve(DOWNLOADS_FOLDER, fileName);
		// console.log(`Del: ${fileDeletePath}`);
		return fs.promises.unlink(fileDeletePath);
	}
}

/**
 * Checks if a specified file name is available in a given folder path. If not, a number in parentheses will be appended to it
 * If 'image.png' does not already exist, inputting 'image.png' into this function will return 'image.png'
 * If 'image.png' already exists, inputting 'image.png' into this function will return 'image (1).png' instead
 * @async
 * @param {string} rootPath The location of the folder to check (Absolute Path Only)
 * @param {string} fileName Name to give the file
 * @param {string} fileExtension File extension
 * @return {Promise<string>} Returns a file name that isn't already being used in the folder
 */
async function getValidFileName(rootPath, fileName, fileExtension) {
	let testFileName = `${fileName}.${fileExtension}`;
	for(let copyCount = 1; copyCount <= FILE_NAME_ITERATOR_LIMIT; copyCount++) {
		let testPath = path.resolve(rootPath, testFileName);
		try {
			await fs.promises.access(testPath, fs.constants.F_OK);
			// console.log(`File: ${testPath} already exists.\nAppending number to path and trying again`);
		} catch(err) {
			if(pendingDownloads.includes(testPath)) {
				// console.log(`Download named ${testPath} is already pending.\nAppending number to path and trying again`);
				continue;
			}
			if(err.code === "ENOENT") return testFileName;
			else console.warn("Unknown error while looking for a path to store download: ", err);
		}
		testFileName = `${fileName} (${copyCount}).${fileExtension}`;
	}
	throw `Could not download file after ${FILE_NAME_ITERATOR_LIMIT} attempts. Rejecting Promise.`;
}

/**
 * Downloads a file from a given URL and save it to a given location
 * @param {string} saveTo File save location (Absolute Path Only)
 * @param {string} downloadFromURL The URL to download from
 * @param {Object} [headers = {}] Optional http request headers
 * @returns {Promise<string>} Returns the path where the file was saved if successful
 */
function completeDownload(saveTo, downloadFromURL, headers = {}) {
	// console.log(`Sav: ${saveTo}`);
	const saveFile = fs.createWriteStream(saveTo);
	return new Promise((resolve, reject) => {
		const request = https.get(downloadFromURL, {
			headers: headers
		}, response => {
			response.pipe(saveFile);
			saveFile.on('finish', async() => {
				await saveFile.close();
				pendingDownloads.splice(pendingDownloads.indexOf(saveTo), 1);
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

/**
 * Returns the size of a file in megabytes
 * @async
 * @param {string} filePath Absolute path to file to check the size of
 * @returns {Promise<number>} Size in megabytes
 */
async function fileSize(filePath) {
	return (await fs.promises.stat(filePath)).size / (1024 * 1024);
}