const fileManager = require("./fileManager.js");
const MessageSyntaxTree = require("./MessageSyntaxTree.js");
const EventEmitter = require('events');

module.exports = class SlackManager {
	static SlackHTTPServerEventAdapter = (require("@slack/events-api")).createEventAdapter(process.env.SLACK_SIGNING_SECRET);
	static client = new (require("@slack/web-api")).WebClient(process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN);
	static AuthData = null;
	static events = new EventEmitter();

	static async start() {
		// Can Disable With Environment Variable
		if(process.env.DISABLE_CHANNEL_JOIN?.trim().toUpperCase() !== "TRUE") {
			console.log("======= Joining Slack Channels ========");
			const channelList = (await this.client.conversations.list()).channels;
			await Promise.all(channelList.map(channel => {
				if(channel["is_channel"] && !channel["is_member"])
					return this.client.conversations.join({ channel: channel.id })
				else
					return Promise.resolve();
			}));
			console.log("======== Slack Channels Joined ========");
		}
		console.log("====== Retrieving Slack App Data ======");
		this.AuthData = await this.client.auth.test();
		console.log("======= Slack App Data Retrieved ======");

		// Prevents script from stopping on errors
		this.SlackHTTPServerEventAdapter.on("error", this.onerror.bind(SlackManager));
		this.SlackHTTPServerEventAdapter.on("message", this.onmessage.bind(SlackManager))
	}

	static onerror(err) {
		console.warn("Something went wrong with the Slack Web API");
		console.error(err);
	}

	static shouldIgnore(message) {
		if(message.bot_id === this.AuthData.bot_id || message?.user === this.AuthData.user_id) return true;
		if(message.subtype === "bot_message") {
			console.warn("BOT MESSAGE RECEIVED - MESSAGE IGNORED");
			console.log(message);
		}
	}

	static async onmessage(message) {
		if(this.shouldIgnore(message)) return;
		/*
		Notes for improving syntax tree parsing
		- Only message.subtype === undefined or 'file_share' has message.user. Assuming that only new content has user property
			- Will need to clone embeds for edits in the future (Makes sense. Just compare text contents or file contents)
		- All events have message.channel (All clear)
		- Files are given ids by Slack, consider storing them. Their mimetypes are also provided by the api

		Plan:
		- Search up channel *ALWAYS*
		- Search up user only in the events that need them
			- Consider splitting the control flow into separate functions based on the subtype instead of handling them all together
			- Fill up syntaxTree with less unnecessary defaults
		- Some testing still needed for threads, pins, channel joins/exits, and more
			- Consider creating new syntax tree classes for different events
		 */
		const syntaxTree = await this.syntaxTreeFromBase(message);

		if(message.thread_ts) syntaxTree.additional.thread = { timestamp: message.thread_ts };

		if(message.subtype === "file_share") {
			// Important Note: Downloads all files locally. Remember to delete them when you are done with fileManager.fileDelete(fileName)
			syntaxTree.attachments.files = await Promise.all(message.files.map(fileData => fileManager.fileDownload(fileData)));
		}

		syntaxTree.attachments.embeds = (message.attachments || [])
			.map(unwrapAttachment);

		if(message.subtype === "me_message") syntaxTree.additional.italicizeAll = true;

		// Note: Some of these subtypes might either not exist or have another method of capture since they don't appear to trigger here
		// noinspection FallThroughInSwitchStatementJS
		switch(message.subtype) {
			case "message_deleted":
				syntaxTree.action = "delete";
				syntaxTree.additional.deletedTimestamp = message.deleted_ts;
				break;
			case "message_changed":
				this.updateSyntaxTree(syntaxTree, message.message);
				syntaxTree.action = "edit";
				// Known bugs:
				// * Does not handle file deletions. For those, delete the entire message instead of just the file itself in order to remove it
				// * Attachments are only parsed again if there were no attachments before but there are now. This means that if an attachment is somehow added in an edit and there was already an attachment before, they are ignored.
				//     * Situations in which this will happen have not been found yet
				// * Attachments may break the order of the logged messages if they process themselves faster than the main embed
				// * Changes that occur before the original message has had a chance to be bridged over may crash the program (It won't shutdown though, it'll just leave a messy error message)
				break;
			/* No Support Added for Groups. If a default channel is being used, there is a chance that the code will still work for groups to some degree if this is uncommented but there are no guarantees
			case "group_join":
			case "group_leave":
			case "group_archive":
			case "group_unarchive":
			case "group_name":
			case "group_purpose":
			case "group_topic": */
			case "channel_topic":
				syntaxTree.action = "update-channel-topic";
			case "channel_join":
			case "channel_leave":
			case "channel_archive":
			case "channel_unarchive":
			case "channel_purpose":
				syntaxTree.action = "update-channel-data";
				break;
			case "channel_name":
				console.log(`Renaming "#${message.old_name}" to "#${message.name}"`);
				syntaxTree.action = "update-channel-name";
				syntaxTree.additional.newName = message.name;
				break;
			case undefined:
			case "me_message": // It's just regular message in italics more or less
			case "thread_broadcast": // Is a message AND a thread... Oh no...
			case "file_share":
			case "bot_message":
				console.log("No additional actions required");
				break;
			case "message_replied":
				console.warn("Received a 'message_replied' message. This is just a thread and it should be working fine.\nJust note that if you see this: There was a bug alert for this subtype that said to check for message.thread_ts instead of using message.subtype to tell if the message is part of a thread. If you see this, it means that it has since been patched and the code should be updated");
			case "unsupported":
				console.log(`No support: ${message.subtype}`);
				break;
			default:
				console.warn(`Unknown Message Subtype ${message.subtype}`);
		}

		// TODO: Look up references to @users and #channels and add them to the syntax tree and populate syntaxTree.parseData
		this.events.emit("message", syntaxTree);
	}

	static async syntaxTreeFromBase(message) {
		const syntaxTree = new MessageSyntaxTree();
		syntaxTree.source = "slack";
		syntaxTree.action = "send";
		this.updateSyntaxTree(syntaxTree, message);
		syntaxTree.parseData.channel = (await this.client.conversations.info({ channel: message.channel })).channel;

		if(message.user) {
			const user = (await this.client.users.info({ user: message.user })).user || { profile: {} };
			syntaxTree.setIfString("name", userIdentify(user));
			syntaxTree.setIfString("color", user.color ? `#${user.color}` : undefined);
			syntaxTree.setIfString("profilePic", user.profile.image_512);
		}

		return syntaxTree;
	}

	static updateSyntaxTree(syntaxTree, message) {
		syntaxTree.unparsedText = message.text || "";
		syntaxTree.timestamp = message.ts;
	}
}

/**
 * Creates a more readable name for each user than their user ID
 * @param {Object} user Slack user object (Normally obtained through Slack's users.info endpoint)
 * @returns {string} String to use as an identifier when logging messages
 */
function userIdentify(user = {}) {
	if(!user.real_name || !user.id) return "Unknown Pupper";
	return `${user.real_name}@${user.id}`;
}

/**
 * Convert an attachment into a MessageSyntaxTree instance
 * TODO: A lot of testing and variations need to be implemented
 */
function unwrapAttachment(attachment) {
	const syntaxTree = new MessageSyntaxTree();
	syntaxTree.source = "slack";
	syntaxTree.setIfString("name", attachment.service_name || attachment.author_name);
	syntaxTree.setIfString("profilePic", attachment.service_icon || attachment.author_icon);
	syntaxTree.additional.profilePicURL = attachment.original_url || attachment.author_link;
	syntaxTree.color = attachment.color;
	syntaxTree.additional.detail = attachment.footer;
	syntaxTree.additional.title = attachment.title || "Attachment";
	syntaxTree.additional.url = attachment.title_link || "";
	// TODO: Decide how to put together additional fields from https://api.slack.com/messaging/composing/layouts#building-attachments
	syntaxTree.unparsedText = attachment.text || attachment.fallback;
	return syntaxTree;
}
