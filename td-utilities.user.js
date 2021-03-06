"use strict";
// ==UserScript==
// @name         Tweetdeck utilities
// @namespace    http://bakemo.no/
// @version      1.1
// @author       Peter Kristoffersen
// @description  Press "-" to clear column, press "q" to open images in selected tweet in full screen.
// @match        https://tweetdeck.twitter.com/*
// @updateUrl    https://github.com/KriPet/td-utilities/raw/master/td-utilities.user.js
// @copyright    2015+, Peter Kristoffersen
// @inject-into  page
// @grant        GM_addStyle
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
    static getVideoElement(videoMedia) {
        const variants = videoMedia.video_info.variants;
        if ((variants?.length ?? 0) == 0) {
            this.log("Video Media has no variants", videoMedia);
            return null;
        }
        variants.sort((b, a) => (a.bitrate ?? -1) - (b.bitrate ?? -1));
        const bestVariant = variants[0];
        const video_container = document.createElement("video");
        const source_element = document.createElement("source");
        video_container.setAttribute("autoplay", "");
        video_container.setAttribute("loop", "");
        video_container.setAttribute("controls", "");
        source_element.setAttribute("src", bestVariant.url);
        video_container.appendChild(source_element);
        return video_container;
    }
    static clearSelectedColumn() {
        const columns = unsafeWindow.TD.controller.columnManager.getAllOrdered();
        const selectedColumnElem = document.querySelector(".is-selected-tweet")?.closest("[data-column]");
        if (selectedColumnElem === null || selectedColumnElem === undefined) {
            this.log("No selected tweet, will not clear column");
            return;
        }
        const target_column_id = selectedColumnElem.getAttribute('data-column');
        if (target_column_id === null) {
            console.log("Could not get ID of selected column");
            return;
        }
        this.log("Target column id: " + target_column_id);
        const selectedColumn = columns.find(col => col.model.getKey() == target_column_id);
        if (selectedColumn === undefined) {
            this.log(`Could not find column with ID '${target_column_id}'`);
            return;
        }
        selectedColumn.clear();
    }
    static log(...data) {
        console.log("Tweetdeck Utilities:", ...data);
    }
    static isMediaRequest(obj) {
        if (obj === null || obj === undefined) {
            return false;
        }
        if (obj.extended_entities !== undefined) {
            return true;
        }
        if (obj.quoted_status_id_str !== undefined) {
            return true;
        }
        return false;
    }
    static onMediaRequestCompleted(request) {
        const rJSON = JSON.parse(request.responseText ?? null);
        if (!this.isMediaRequest(rJSON)) {
            this.log("Something is wrong with the received media response");
            this.log(request.responseText);
            return;
        }
        this.log("Got media request JSON", rJSON);
        if (rJSON.extended_entities === undefined) {
            if (rJSON.quoted_status_id_str !== undefined) {
                this.log("Found quoted tweet. Running new media request");
                this.mediaRequest(rJSON.quoted_status_id_str);
                return;
            }
            this.log("Can't find extended entities or quoted tweet. Aborting.");
            return;
        }
        const media = rJSON.extended_entities.media;
        this.log("media", media);
        for (const m of media) {
            if (m.type === "video" || m.type == "animated_gif") {
                //Handle video
                const videoElement = this.getVideoElement(m);
                if (videoElement !== null) {
                    this.overlayElementQueue.push(videoElement);
                }
            }
            else if (m.type === "photo") {
                const url = m.media_url_https + ":orig";
                const photoContainer = document.createElement("img");
                photoContainer.setAttribute("src", url);
                this.overlayElementQueue.push(photoContainer);
            }
        }
        if (this.overlayElementQueue.length > 0) {
            this.showNextElementOnOverlay();
        }
        else {
            console.log("Couldn't find any media");
        }
    }
    static onMediaRequestStateChange(request) {
        this.log(`Got readyState ${request.readyState} on media request`);
        if (request.readyState === 4) {
            this.log(`Got status ${request.status} on media request`);
            if (request.status === 200) {
                this.onMediaRequestCompleted(request);
            }
        }
    }
    static mediaRequest(tweetId) {
        const url = `https://api.twitter.com/1.1/statuses/show.json?include_entities=true&tweet_mode=extended&id=${tweetId}`;
        const request = new XMLHttpRequest();
        request.onreadystatechange = () => this.onMediaRequestStateChange(request);
        request.open("GET", url);
        request.setRequestHeader("Authorization", `Bearer ${unsafeWindow.TD.config.bearer_token}`);
        request.send();
    }
    static clearAndHideOverlay() {
        this.imageOverlayInner.innerHTML = "";
        this.imageOverlayContainer.style.display = "none";
    }
    static showNextElementOnOverlay() {
        this.imageOverlayInner.innerHTML = "";
        this.imageOverlayContainer.style.display = "block";
        const newMedia = this.overlayElementQueue.shift();
        if (newMedia !== undefined) {
            this.imageOverlayInner.appendChild(newMedia);
        }
    }
    static toggleOrAdvanceImageOverlay() {
        if (this.imageOverlayContainer.style.display == "block") {
            if (this.overlayElementQueue.length === 0) {
                this.clearAndHideOverlay();
            }
            else {
                this.showNextElementOnOverlay();
            }
        }
        else {
            const tweetId = document.querySelector("article.is-selected-tweet")?.getAttribute('data-tweet-id');
            if (tweetId === null || tweetId === undefined) {
                this.log("Could not find tweet ID");
                return;
            }
            this.mediaRequest(tweetId);
        }
    }
    static initialize() {
        if (this.initialized) {
            this.log("Already initialized");
            return;
        }
        this.initialized = true;
        this.log("Initializing");
        this.overlayElementQueue = new QueueWithCallback((array) => this.imageOverlayCounter.innerText = `Left: ${array.length}`);
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
        GM_addStyle(`
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
        }`);
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
