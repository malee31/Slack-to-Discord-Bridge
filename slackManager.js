const fileManager = require("./fileManager.js");
const SyntaxTree = require("./MessageSyntaxTree.js");
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
		this.SlackHTTPServerEventAdapter.on("error", this.onerror);
		this.SlackHTTPServerEventAdapter.on("message", this.splitEvents);
	}

	static onerror(err) {
		console.warn("Something went wrong with the Slack Web API");
		console.error(err);
	}

	static shouldIgnore(message) {
		if(message.bot_id === SlackManager.AuthData.bot_id || message?.user === SlackManager.AuthData.user_id) return true;
		if(message.subtype === "bot_message") {
			console.warn("BOT MESSAGE RECEIVED - MESSAGE IGNORED");
			console.log(message);
		}
	}

	static splitEvents(message) {
		if(SlackManager.shouldIgnore(message)) return;

		// Note: Some of these subtypes might either not exist or have another method of capture since they don't appear to trigger here
		switch(message.subtype) {
			case "message_deleted":
				return SlackManager.onDelete(message);
			case "message_changed":
				return SlackManager.onchange(message);
			case undefined:
			case "me_message": // It's just regular message in italics more or less
			case "thread_broadcast": // Is a message AND a thread... Oh no...
			case "bot_message": // Might need a custom function to work properly. Use bots.info to search up user if needed
			case "file_share":
				return SlackManager.onMessage(message);
			/* No Support Added for Groups. If a default channel is being used, there is a chance that the code will still work for groups to some degree if this is uncommented but there are no guarantees
			case "group_join":
			case "group_leave":
			case "group_archive":
			case "group_unarchive":
			case "group_name":
			case "group_purpose":
			case "group_topic": */
			case "channel_join":
			case "channel_leave":
			case "channel_archive":
			case "channel_unarchive":
				// Reuse message feature? Should I port this over at all???
				break;
			case "channel_name":
			case "channel_topic":
			case "channel_purpose":
				return SlackManager.onChannelUpdate(message);
			default:
				console.warn(`Unknown Message Subtype ${message.subtype}`);
		}
	}

	static async onchange(message) {
		const syntaxTree = SlackManager.syntaxTreeFromBase(new SyntaxTree.ChangeSyntaxTree(), message);
		syntaxTree.parseData.channel = await SlackManager.client.channels.info({ channel: message.channel });
		SlackManager.updateSyntaxTree(syntaxTree, message.message);
		// Known bugs:
		// * Does not handle file deletions. For those, delete the entire message instead of just the file itself in order to remove it
		// * Attachments are only parsed again if there were no attachments before but there are now. This means that if an attachment is somehow added in an edit and there was already an attachment before, they are ignored.
		//     * Situations in which this will happen have not been found yet
		// * Attachments may break the order of the logged messages if they process themselves faster than the main embed
		// * Changes that occur before the original message has had a chance to be bridged over may crash the program (It won't shutdown though, it'll just leave a messy error message)
		this.events.emit("change", syntaxTree);
	}

	static async onDelete(message) {
		const syntaxTree = SlackManager.syntaxTreeFromBase(new SyntaxTree.DeleteSyntaxTree(), message);
		syntaxTree.parseData.channel = await SlackManager.client.channels.info({ channel: message.channel });
		syntaxTree.additional.deletedTimestamp = message.deleted_ts;
		this.events.emit("delete", syntaxTree);
	}

	static async onMessage(message) {
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
		const syntaxTree = await SlackManager.syntaxTreeFromBase(new SyntaxTree.MessageSyntaxTree(), message);

		syntaxTree.parseData.channel = await SlackManager.client.channels.info({ channel: message.channel });

		// Important Note: Downloads all files locally. Remember to delete them when you are done with fileManager.fileDelete(fileName)
		if(message.subtype === "file_share") syntaxTree.attachments.files = await Promise.all(message.files.map(fileData => fileManager.fileDownload(fileData)));

		syntaxTree.attachments.embeds = (message.attachments || [])
			.map(unwrapAttachment);

		if(message.subtype === "me_message") syntaxTree.additional.italicizeAll = true;

		// TODO: Look up references to @users and #channels and add them to the syntax tree and populate syntaxTree.parseData
		this.events.emit("message", syntaxTree);
	}

	static async onChannelUpdate(message) {
		// TODO: Implement
	}

	static async syntaxTreeFromBase(syntaxTree, message) {
		syntaxTree.source = "slack";
		SlackManager.updateSyntaxTree(syntaxTree, message);
		syntaxTree.parseData.channel = (await SlackManager.client.conversations.info({ channel: message.channel })).channel;

		if(message.thread_ts) syntaxTree.additional.thread = { timestamp: message.thread_ts };

		if(message.user) {
			const user = (await SlackManager.client.users.info({ user: message.user })).user || { profile: {} };
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
	const syntaxTree = new SyntaxTree.MessageSyntaxTree();
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
