const https = require("https");
const path = require("path");
const fs = require("fs");

const DEFAULT_TOKEN = process.env[process.env.SLACK_DOWNLOAD_ACCESS_TOKEN_CHOICE || "SLACK_BOT_USER_OAUTH_ACCESS_TOKEN"];
const DOWNLOADS_FOLDER = path.resolve(__dirname, "downloads");
const FAILED_DOWNLOAD_IMAGE_PATH = path.resolve(__dirname, "placeholders", "ERROR.png");
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
	 * @param {string} [auth] Alternative token to use (in place of the environment variables)
	 * @returns {Promise<{path: string, extension: (string|*), original: ({name}|*), size: *, name, title, storedAs: string}>} An object containing details on where the file is, what is is called, the original Slack file object, and more
	 */
	fileDownload: async(fileObj, fileName, auth) => {
		fileName = (fileName || fileObj.name).replace(/\//g, " - ");
		let split = fileName.split(".");
		let fileFormat = { extension: fileName.includes(".") ? split.pop() : "", name: split.join(".") };
		fileName = await getValidFileName(DOWNLOADS_FOLDER, fileFormat.name, fileFormat.extension);

		let finalDownloadPath = path.resolve(DOWNLOADS_FOLDER, fileName);
		pendingDownloads.push(finalDownloadPath);

		try {
			await completeDownload(finalDownloadPath, fileObj["url_private_download"], {
				Authorization: `Bearer ${auth || DEFAULT_TOKEN}`
			}, true);
		} catch(err) {
			console.error(`Failed to Download File. Using Default File as Attachment. Reason: ${err}`);
			finalDownloadPath = FAILED_DOWNLOAD_IMAGE_PATH;
		}

		// fileObj.size has the size in bytes too but it isn't as accurate
		const downloadSize = await fileSize(finalDownloadPath);

		return {
			name: fileObj.name,
			title: fileObj.title,
			path: finalDownloadPath,
			storedAs: fileName,
			extension: fileFormat.extension,
			size: downloadSize,
			original: fileObj,
			id: fileObj.id
		};
	},

	/**
	 * Deletes a file from the downloads folder specifically
	 * @param {string} fileName Name of file to delete from the downloads folder
	 * @returns {Promise<void>} Returns the promise from fs.promises.unlink
	 */
	fileDelete,
	FAILED_DOWNLOAD_IMAGE_PATH
}

/**
 * Checks if a specified file name is available in a given folder path. If not, a number in parentheses will be appended to it
 * If 'image.png' does not already exist, inputting 'image.png' into this function will return 'image.png'
 * If 'image.png' already exists, inputting 'image.png' into this function will return 'image (1).png' instead
 * @async
 * @param {string} rootPath The location of the folder to check (Absolute Path Only)
 * @param {string} fileName Name to give the file
 * @param {string} fileExtension File extension
 * @returns {Promise<string>} Returns a file name that isn't already being used in the folder
 */
async function getValidFileName(rootPath, fileName, fileExtension) {
	let testFileName = `${fileName}.${fileExtension}`;
	for(let copyCount = 1; copyCount <= FILE_NAME_ITERATOR_LIMIT; copyCount++) {
		let testPath = path.resolve(rootPath, testFileName);
		try {
			// console.log(`Testing ${testPath}`);
			await fs.promises.access(testPath, fs.constants.F_OK);
			// console.log(`File: ${testPath} already exists.\nAppending number to path and trying again`);
		} catch(err) {
			if(!pendingDownloads.includes(testPath)) {
				if(err.code === "ENOENT") {
					return testFileName;
				} else {
					console.warn("Unknown error while looking for a path to store download: ", err);
				}
			}
		}
		testFileName = `${fileName} (${copyCount}).${fileExtension}`;
	}
	throw `Could not download file after ${FILE_NAME_ITERATOR_LIMIT} attempts. Rejecting Promise.`;
}

/**
 * Downloads a file from a given URL and save it to a given location
 * @async
 * @param {string} saveTo File save location (Absolute Path Only)
 * @param {string} downloadFromURL The URL to download from
 * @param {Object} [headers = {}] Optional http request headers
 * @param {boolean} [rejectOnRedirect = false] Reject promise on redirects instead of following
 * @returns {Promise<string>} Returns the path where the file was saved if successful
 */
async function completeDownload(saveTo, downloadFromURL, headers = {}, rejectOnRedirect = false) {
	return new Promise((resolve, reject) => {
		https.get(downloadFromURL, {
			headers: headers
		})
			.on("response", response => {
				// Redirect handling code. Recursively calls the completeDownload function until no longer redirected so an infinite loop is possible
				if(response.statusCode >= 300 && response.statusCode < 400) {
					const redirectURL = response.headers.location.startsWith("/") ? `${response.req.protocol}//${response.req.host}${response.headers.location}` : response.headers.location;
					if(rejectOnRedirect) {
						return reject(new Error(`[HTTP ${response.statusCode}] Redirect Returned from [${downloadFromURL}] to [${redirectURL}]`));
					}
					console.warn(`[HTTP ${response.statusCode}] Following Redirect to File at [${redirectURL}]\nNote that if this happens and fails a lot, the token may be invalid`);
					return resolve(completeDownload(saveTo, `${redirectURL}`, headers));
				}

				if(response.statusCode !== 200) {
					console.warn(`[HTTP ${response.statusCode}] [${response.statusMessage}] from [${downloadFromURL}]\n↑ ↑ ↑ Request Returned a Non-200 Status Code. Proceeding Anyways...`);
				}

				console.log(`Saving a File to ${saveTo} from ${downloadFromURL}`);

				const saveFile = fs.createWriteStream(saveTo);
				saveFile
					.on('finish', () => {
						pendingDownloads.splice(pendingDownloads.indexOf(saveTo), 1);
						resolve(saveTo);
					}).on("error", err => completeDownloadErrorHandler(err, saveTo));

				response
					.pipe(saveFile)
					.on("error", err => {
						console.warn(`Unable to Pipe File Contents into File: ${err}`);
						saveFile.end();
						reject(completeDownloadErrorHandler(err, saveTo));
					});
			}).on("error",
			err => completeDownloadErrorHandler(err)
		);
	});
}

/**
 * Error handler for completeDownload. Tries to delete file on a failed download
 * @async
 * @param {Error} err Error from completeDownload
 * @param {string} [unlinkLocation] Path of intended file to unlink
 * @return {Promise} Throws errors through the Promise
 */
async function completeDownloadErrorHandler(err, unlinkLocation) {
	// Blindly deletes the file asynchronously on error
	if(unlinkLocation) {
		await fileDelete(unlinkLocation)
			.catch(unlinkErr => {
				throw new Error(`Download Failed and Unlink Failed: ${unlinkErr}`);
			});
	}
	throw new Error(`Download Failed: ${err}`);
}

/**
 * Returns the size of a file in megabytes
 * @async
 * @param {string} filePath Absolute path to file to check the size of
 * @returns {Promise<number>} Size in megabytes (Includes decimals)
 */
async function fileSize(filePath) {
	return (await fs.promises.stat(filePath)).size / (1024 * 1024);
}

/**
 * Deletes a file from the downloads folder specifically
 * @param {string} fileName Name of file to delete from the downloads folder
 * @returns {Promise<void>} Returns the promise from fs.promises.unlink
 */
function fileDelete(fileName) {
	let fileDeletePath = path.resolve(DOWNLOADS_FOLDER, fileName);
	// console.log(`Del: ${fileDeletePath}`);
	return process.env.DISABLE_FILE_DELETION?.trim().toLowerCase() === "true" ? Promise.resolve() : fs.promises.unlink(fileDeletePath);
}