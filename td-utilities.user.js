"use strict";
// ==UserScript==
// @name         Tweetdeck utilities
// @namespace    http://bakemo.no/
// @version      1.5.1
// @author       Peter Kristoffersen
// @description  Press "-" to clear column, press "q" to open images in selected tweet in full screen.
// @match        https://tweetdeck.twitter.com/*
// @match        https://twitter.com/i/tweetdeck
// @downloadURL  https://github.com/KriPet/td-utilities/raw/master/td-utilities.user.js
// ==/UserScript==
class QueueWithCallback {
    constructor(callback) {
        this.innerArray = [];
        this.cb = callback;
    }
    get length() {
        return this.innerArray.length;
    }
    shift() {
        const ret = this.innerArray.shift();
        this.cb(this.innerArray);
        return ret;
    }
    push(elem) {
        const ret = this.innerArray.push(elem);
        this.cb(this.innerArray);
        return ret;
    }
}
class TweetdeckUtilities {
    static clearSelectedColumn() {
        const selectedTweetElem = document.querySelector(".is-selected-tweet");
        const selectedTweetDataset = selectedTweetElem === null || selectedTweetElem === void 0 ? void 0 : selectedTweetElem.dataset;
        const selectedTweetId = selectedTweetDataset === null || selectedTweetDataset === void 0 ? void 0 : selectedTweetDataset.key;
        if (selectedTweetElem == null || selectedTweetId == null) {
            this.log("No selected tweet, will not clear column");
            return;
        }
        const columnElem = selectedTweetElem.closest(".js-column");
        const columnDataSet = columnElem === null || columnElem === void 0 ? void 0 : columnElem.dataset;
        const columnId = columnDataSet === null || columnDataSet === void 0 ? void 0 : columnDataSet.column;
        if (columnId == null) {
            this.log("Could not find column");
            return;
        }
        const column = unsafeWindow.TD.controller.columnManager.get(columnId);
        const tweet = column.findChirp(selectedTweetId);
        if (tweet) {
            this.clearUpTo(column, tweet);
            return;
        }
        this.log(`Could not find tweet with ID '${selectedTweetId}'`);
    }
    static clearUpTo(col, tweet) {
        const timeStamp = tweet.created.getTime();
        col.model.setClearedTimestamp(timeStamp);
        const tweetIndex = col.updateArray.indexOf(tweet);
        col.discardTweetsNotInRange(0, tweetIndex);
    }
    static log(...data) {
        console.log("Tweetdeck Utilities:", ...data);
    }
    static clearAndHideOverlay() {
        this.imageOverlayInner.innerHTML = "";
        this.imageOverlayContainer.style.display = "none";
    }
    static showNextElementOnOverlay() {
        var _a;
        this.imageOverlayInner.innerHTML = "";
        this.imageOverlayContainer.style.display = "block";
        const newMedia = this.overlayElementQueue.shift();
        if (newMedia !== undefined) {
            this.imageOverlayInner.appendChild(newMedia);
            (_a = newMedia.parentElement) === null || _a === void 0 ? void 0 : _a.querySelectorAll("video").forEach(v => v.autoplay = true);
        }
    }
    static toggleOrAdvanceImageOverlay() {
        if (this.imageOverlayContainer.style.display === "block") {
            if (this.overlayElementQueue.length === 0) {
                this.clearAndHideOverlay();
            }
            else {
                this.showNextElementOnOverlay();
            }
        }
        else {
            const selectedTweet = document.querySelector("article.is-selected-tweet");
            if (selectedTweet == null) {
                this.log("Could not find selected tweet");
                return;
            }
            const numEntities = this.findEntities(selectedTweet);
            console.log(`Found ${numEntities} entities`);
            if (this.overlayElementQueue.length > 0) {
                this.showNextElementOnOverlay();
            }
            else {
                console.log("Couldn't find any media");
            }
        }
    }
    static findEntities(element) {
        var _a;
        const tweetId = element.dataset["key"];
        const columnId = (_a = element.closest(".js-chirp-container, .js-column")) === null || _a === void 0 ? void 0 : _a.dataset["column"];
        if (!tweetId || !columnId)
            return 0;
        const column = unsafeWindow.TD.controller.columnManager.get(columnId);
        if (!column)
            return 0;
        const tweetObject = column.findChirp(tweetId);
        return this.findEntitiesInner(tweetObject);
    }
    static findEntitiesInner(tweetObject) {
        var _a;
        if (!tweetObject)
            return 0;
        console.info("Tweet Object", tweetObject);
        for (const medium of tweetObject.entities.media) {
            if (medium.type === "video" || medium.type === "animated_gif") {
                const videoElement = document.createElement("video");
                videoElement.loop = true;
                videoElement.poster = medium.media_url_https;
                videoElement.controls = true;
                const variants = Array.from(medium.video_info.variants);
                variants.sort((a, b) => { var _a, _b; return ((_a = b.bitrate) !== null && _a !== void 0 ? _a : 0) - ((_b = a.bitrate) !== null && _b !== void 0 ? _b : 0); });
                for (const source of variants) {
                    const sourceElement = document.createElement("source");
                    sourceElement.src = (_a = source.url) !== null && _a !== void 0 ? _a : "";
                    sourceElement.type = source.content_type;
                    videoElement.appendChild(sourceElement);
                }
                this.overlayElementQueue.push(videoElement);
            }
            else {
                const imageElement = document.createElement("img");
                const imageUrl = new URL(medium.media_url_https);
                imageUrl.searchParams.set("name", "orig");
                imageElement.src = imageUrl.toString();
                this.overlayElementQueue.push(imageElement);
            }
        }
        return tweetObject.entities.media.length + this.findEntitiesInner(tweetObject.quotedTweet);
    }
    static initialize() {
        if (this.initialized) {
            this.log("Already initialized");
            return;
        }
        this.initialized = true;
        this.log("Initializing");
        this.overlayElementQueue = new QueueWithCallback((array) => {
            this.imageOverlayCounter.innerText = `Left: ${array.length}`;
        });
        this.log("Creating image overlay");
        this.createImageOverlayElem();
        this.log("Adding styles");
        this.addStyles();
        this.log("Binding listeners");
        this.bindListeners();
        this.log("Done initializing");
    }
    static createImageOverlayElem() {
        this.imageOverlayCounter = document.createElement("span");
        this.imageOverlayCounter.classList.add("counter");
        this.imageOverlayInner = document.createElement("div");
        this.imageOverlayInner.classList.add("inner");
        this.imageOverlayContainer = document.createElement("div");
        this.imageOverlayContainer.classList.add("image_overlay");
        this.imageOverlayContainer.style.display = "none";
        this.imageOverlayContainer.appendChild(this.imageOverlayCounter);
        this.imageOverlayContainer.appendChild(this.imageOverlayInner);
        document.body.append(this.imageOverlayContainer);
    }
    static addStyles() {
        const head = document.getElementsByTagName("head")[0];
        if (head == null) {
            return;
        }
        const style = document.createElement("style");
        style.setAttribute('type', 'text/css');
        style.textContent = `
        div.image_overlay{
            height: 95%;
            width: 95%;
            position: fixed;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            z-index: 1000000;
            border-radius: 10px;
            background: rgba(100, 21, 148, 0.91);
        }

        div.image_overlay img, div.image_overlay video{
            border: 0;
            max-width: 98%;
            max-height: 98%;
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
        }`;
        head.appendChild(style);
    }
    static bindListeners() {
        document.addEventListener('keyup', (event) => {
            switch (event.key) {
                case "-": {
                    this.clearSelectedColumn();
                    break;
                }
                case "q": {
                    this.toggleOrAdvanceImageOverlay();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
            }
        });
    }
}
TweetdeckUtilities.initialized = false;
TweetdeckUtilities.initialize();
