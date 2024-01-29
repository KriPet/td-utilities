// ==UserScript==
// @name         Tweetdeck utilities
// @namespace    http://bakemo.no/
// @version      1.5.0
// @author       Peter Kristoffersen
// @description  Press "-" to clear column, press "q" to open images in selected tweet in full screen.
// @match        https://tweetdeck.twitter.com/*
// @match        https://twitter.com/i/tweetdeck
// @downloadURL  https://github.com/KriPet/td-utilities/raw/master/td-utilities.user.js
// ==/UserScript==

declare const unsafeWindow: Window & {
    TD: {
        config: { bearer_token: string },
        controller: {
            columnManager: {
                getAllOrdered(): ITweetdeckColumn[],
                get(columnId: string): ITweetdeckColumn
            }
        },
        util: { getCsrfTokenHeader: () => string }
    }
}

interface ITweetdeckColumn {
    model: {
        getKey: () => string;
        getClearedTimestamp: () => number;
        setClearedTimestamp: (time: number) => void;
    }
    clear: () => void;
    discardTweetsNotInRange: (from: number, to: number) => void;
    reset: () => void;
    annihilateChirps: (tweetIds: string[], options: { willBreakScrollPosition: boolean }) => void;
    updateArray: ITweetdeckTweet[];
    findChirp: (tweetId: string) => ITweetdeckTweet;
}

interface ITweetdeckTweet {
    id: string
    created: Date
    entities: { media: (IMedia)[] }
    quotedTweet?: ITweetdeckTweet
}

type IMedia = IVideoMedia | IPhotoMedia;

interface IVideoMedia {
    video_info: { variants: { url: string, content_type: string }[] }
    type: "video" | "animated_gif"
    media_url_https: string
}

interface IPhotoMedia {
    type: "photo"
    media_url_https: string
}

class QueueWithCallback<T> {
    private readonly innerArray: T[];
    private readonly cb: (currentArray: T[]) => void;
    constructor(callback: (currentArray: T[]) => void) {
        this.innerArray = []
        this.cb = callback
    }

    public get length() {
        return this.innerArray.length
    }

    public shift() {
        const ret = this.innerArray.shift()
        this.cb(this.innerArray)
        return ret
    }

    public push(elem: T) {
        const ret = this.innerArray.push(elem)
        this.cb(this.innerArray)
        return ret
    }
}

class TweetdeckUtilities {
    private static overlayElementQueue: QueueWithCallback<HTMLElement>;
    private static imageOverlayContainer: HTMLDivElement;
    private static imageOverlayInner: HTMLDivElement;
    private static imageOverlayCounter: HTMLSpanElement;
    private static initialized = false;

    private static clearSelectedColumn(): void {
        const columns = unsafeWindow.TD.controller.columnManager.getAllOrdered()
        const selectedTweetElem = document.querySelector(".is-selected-tweet") as HTMLDivElement | null
        const selectedTweetDataset = selectedTweetElem?.dataset as null | { "key": undefined }

        const selectedTweetId = selectedTweetDataset?.key
        if (selectedTweetId == null) {
            this.log("No selected tweet, will not clear column")
            return
        }

        for (const col of columns) {
            const tweet = col.findChirp(selectedTweetId)
            if (tweet) {
                this.clearUpTo(col, tweet)
                return
            }
        }
        this.log(`Could not find tweet with ID '${selectedTweetId}'`)
    }

    private static clearUpTo(col: ITweetdeckColumn, tweet: ITweetdeckTweet) {
        const timeStamp = tweet.created.getTime()
        col.model.setClearedTimestamp(timeStamp)
        const tweetIndex = col.updateArray.indexOf(tweet)
        col.discardTweetsNotInRange(0, tweetIndex)
    }

    private static log(...data: any[]) {
        console.log("Tweetdeck Utilities:", ...data)
    }

    private static clearAndHideOverlay() {
        this.imageOverlayInner.innerHTML = ""
        this.imageOverlayContainer.style.display = "none"
    }

    private static showNextElementOnOverlay() {
        this.imageOverlayInner.innerHTML = ""
        this.imageOverlayContainer.style.display = "block"
        const newMedia = this.overlayElementQueue.shift()
        if (newMedia !== undefined) {
            this.imageOverlayInner.appendChild(newMedia)
            newMedia.parentElement?.querySelectorAll("video").forEach(v => v.autoplay = true);
        }
    }

    private static toggleOrAdvanceImageOverlay(): void {
        if (this.imageOverlayContainer.style.display === "block") {
            if (this.overlayElementQueue.length === 0) {
                this.clearAndHideOverlay()
            } else {
                this.showNextElementOnOverlay()
            }
        } else {
            const selectedTweet = document.querySelector<HTMLElement>("article.is-selected-tweet");
            if (selectedTweet == null) {
                this.log("Could not find selected tweet")
                return
            }
            const numEntities = this.findEntities(selectedTweet);
            console.log(`Found ${numEntities} entities`);

            if (this.overlayElementQueue.length > 0) {
                this.showNextElementOnOverlay()
            } else {
                console.log("Couldn't find any media")
            }
        }
    }

    private static findEntities(element: HTMLElement) {
        const tweetId = element.dataset["key"]
        const columnId = element.closest<HTMLElement>(".js-chirp-container, .js-column")?.dataset["column"]
        if (!tweetId || !columnId)
            return 0
        const column = unsafeWindow.TD.controller.columnManager.get(columnId);
        if (!column)
            return 0
        const tweetObject = column.findChirp(tweetId);

        return this.findEntitiesInner(tweetObject);
    }

    private static findEntitiesInner(tweetObject?: ITweetdeckTweet): number {
        if (!tweetObject)
            return 0
        console.info("Tweet Object", tweetObject)

        for (const medium of tweetObject.entities.media) {
            if (medium.type === "video" || medium.type === "animated_gif") {
                const videoElement = document.createElement("video");
                videoElement.loop = true;
                videoElement.poster = medium.media_url_https;
                videoElement.controls = true;
                for (const source of medium.video_info.variants) {
                    const sourceElement = document.createElement("source");
                    sourceElement.src = source.url ?? "";
                    sourceElement.type = source.content_type;
                    videoElement.appendChild(sourceElement);
                }

                this.overlayElementQueue.push(videoElement);
            } else {
                const imageElement = document.createElement("img");
                const imageUrl = new URL(medium.media_url_https);
                imageUrl.searchParams.set("name", "orig");
                imageElement.src = imageUrl.toString();
                this.overlayElementQueue.push(imageElement);
            }
        }

        return tweetObject.entities.media.length + this.findEntitiesInner(tweetObject.quotedTweet);
    }

    public static initialize() {
        if (this.initialized) {
            this.log("Already initialized")
            return
        }
        this.initialized = true
        this.log("Initializing")
        this.overlayElementQueue = new QueueWithCallback((array) => {
            this.imageOverlayCounter.innerText = `Left: ${array.length}`
        })
        this.log("Creating image overlay")
        this.createImageOverlayElem()
        this.log("Adding styles")
        this.addStyles()
        this.log("Binding listeners")
        this.bindListeners()
        this.log("Done initializing")
    }

    private static createImageOverlayElem() {
        this.imageOverlayCounter = document.createElement("span")
        this.imageOverlayCounter.classList.add("counter")
        this.imageOverlayInner = document.createElement("div")
        this.imageOverlayInner.classList.add("inner")

        this.imageOverlayContainer = document.createElement("div")
        this.imageOverlayContainer.classList.add("image_overlay")
        this.imageOverlayContainer.style.display = "none"
        this.imageOverlayContainer.appendChild(this.imageOverlayCounter)
        this.imageOverlayContainer.appendChild(this.imageOverlayInner)
        document.body.append(this.imageOverlayContainer)
    }

    private static addStyles() {
        const head = document.getElementsByTagName("head")[0]
        if (head == null) {
            return
        }
        const style = document.createElement("style")
        style.setAttribute('type', 'text/css')
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
        }`
        head.appendChild(style)
    }

    private static bindListeners() {
        document.addEventListener('keyup', (event) => {
            switch (event.key) {
                case "-": {
                    this.clearSelectedColumn()
                    break
                }
                case "q": {
                    this.toggleOrAdvanceImageOverlay()
                    event.preventDefault()
                    event.stopPropagation()
                    break
                }
            }
        })
    }
}

TweetdeckUtilities.initialize()
