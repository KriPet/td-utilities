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


declare const unsafeWindow: Window & { 
    TD: {
        config: { bearer_token: string},
        controller: {columnManager: {getAllOrdered: () => ITweetdeckColumn[]}}
    }
};

declare const GM_addStyle: (style: string) => void;


interface ITweetdeckColumn{
    model: {getKey: () => string }
    clear: () => void;
}

type IMedia = IVideoMedia | IPhotoMedia;

interface IVideoVariant{
    bitrate?: number;
    url: string;
}

interface IVideoMedia {
    type: "video" | "animated_gif"
    video_info: {variants: IVideoVariant[]}
}

interface IPhotoMedia {
    type: "photo"
    media_url_https: string;
}

interface IExtendedEntities{
    media: IMedia[];
}

interface IMediaRequest {
    extended_entities?: IExtendedEntities;
    quoted_status_id_str?: string;
}

class QueueWithCallback<T>{
    private readonly innerArray :T[];
    private readonly cb: (currentArray: T[]) => void;
    constructor(callback: (currentArray: T[]) => void){
        this.innerArray = [];
        this.cb = callback;
    }
    public get length() {
        return this.innerArray.length;
    }
    public shift(){
        const ret =  this.innerArray.shift();
        this.cb(this.innerArray);
        return ret;
    }
    public push(elem: T){
        const ret = this.innerArray.push(elem);
        this.cb(this.innerArray);
        return ret;
    }
}

class TweetdeckUtilities{
    private static overlayElementQueue: QueueWithCallback<HTMLElement>;
    private static imageOverlayContainer: HTMLDivElement;
    private static imageOverlayInner: HTMLDivElement;
    private static imageOverlayCounter: HTMLSpanElement;
    private static initialized = false;
    
    private static getVideoElement(videoMedia: IVideoMedia){
        const variants = videoMedia.video_info.variants;
        
        if((variants?.length ?? 0) == 0){
            this.log("Video Media has no variants", videoMedia);
            return null;
        }
        
        variants.sort((b,a) => (a.bitrate ?? -1) - (b.bitrate ?? -1));
        const bestVariant = variants[0];
        const video_container = document.createElement("video");
        const source_element = document.createElement("source");
        video_container.setAttribute("autoplay","");
        video_container.setAttribute("loop","");
        video_container.setAttribute("controls", "");
        source_element.setAttribute("src", bestVariant.url);
        video_container.appendChild(source_element);
        return video_container;
    }
    
    
    private static clearSelectedColumn() : void {
        const columns = unsafeWindow.TD.controller.columnManager.getAllOrdered();
        const selectedColumnElem = document.querySelector(".is-selected-tweet")?.closest("[data-column]");
        if(selectedColumnElem === null || selectedColumnElem === undefined){
            this.log("No selected tweet, will not clear column");
            return;
        }
        const target_column_id = selectedColumnElem.getAttribute('data-column');
        if(target_column_id === null){
            console.log("Could not get ID of selected column");
            return;
        }
        this.log("Target column id: " + target_column_id);
        
        const selectedColumn = columns.find(col => col.model.getKey() == target_column_id);
        if(selectedColumn === undefined){
            this.log(`Could not find column with ID '${target_column_id}'`);
            return;
        }
        
        selectedColumn.clear();
    }
    
    private static log(...data: any[]){
        console.log("Tweetdeck Utilities:", ...data);
    }
    
    private static isMediaRequest(obj: unknown) : obj is IMediaRequest
    {
        if(obj === null || obj === undefined){
            return false;
        }
        if((obj as IMediaRequest).extended_entities !== undefined){
            return true;
        }
        if((obj as IMediaRequest).quoted_status_id_str !== undefined){
            return true;
        }
        return false;
    }
    
    private static onMediaRequestCompleted(request: XMLHttpRequest){
        const rJSON : unknown = JSON.parse(request.responseText ?? null);
        if(!this.isMediaRequest(rJSON)){
            this.log("Something is wrong with the received media response");
            this.log(request.responseText);
            return;
        }
        this.log("Got media request JSON", rJSON);
        
        if(rJSON.extended_entities === undefined){
            if(rJSON.quoted_status_id_str !== undefined){
                this.log("Found quoted tweet. Running new media request");
                this.mediaRequest(rJSON.quoted_status_id_str);
                return;
            }
            this.log("Can't find extended entities or quoted tweet. Aborting.");
            return;
        }
        
        const media = rJSON.extended_entities.media;
        this.log("media", media);
        
        for(const m of media){
            if(m.type==="video" || m.type=="animated_gif"){
                //Handle video
                const videoElement = this.getVideoElement(m);
                if(videoElement !== null){
                    this.overlayElementQueue.push(videoElement);
                }
            }else if(m.type==="photo"){
                const url = m.media_url_https + ":orig";
                const photoContainer = document.createElement("img");
                photoContainer.setAttribute("src", url);
                this.overlayElementQueue.push(photoContainer);
            }
        }
        
        if(this.overlayElementQueue.length>0){
            this.showNextElementOnOverlay();
        }else{
            console.log("Couldn't find any media");
        }
    }
    
    private static onMediaRequestStateChange(request: XMLHttpRequest){
        this.log(`Got readyState ${request.readyState} on media request`);
        if(request.readyState === 4){
            this.log(`Got status ${request.status} on media request`);
            if(request.status === 200){
                this.onMediaRequestCompleted(request);
            }
        }
    }
    
    private static mediaRequest(tweetId: string){
        const url = `https://api.twitter.com/1.1/statuses/show.json?include_entities=true&tweet_mode=extended&id=${tweetId}`;
        const request = new XMLHttpRequest();
        request.onreadystatechange = () => this.onMediaRequestStateChange(request);
        request.open("GET", url);
        request.setRequestHeader("Authorization", `Bearer ${unsafeWindow.TD.config.bearer_token}`);
        request.send();
    }
    
    private static clearAndHideOverlay(){
        this.imageOverlayInner.innerHTML = "";
        this.imageOverlayContainer.style.display = "none";
    }
    private static showNextElementOnOverlay(){
        this.imageOverlayInner.innerHTML = "";
        this.imageOverlayContainer.style.display = "block";
        const newMedia = this.overlayElementQueue.shift();
        if(newMedia !== undefined){
            this.imageOverlayInner.appendChild(newMedia);
        }
    }
    
    private static toggleOrAdvanceImageOverlay(): void{
        if(this.imageOverlayContainer.style.display == "block"){
            if(this.overlayElementQueue.length === 0){
                this.clearAndHideOverlay();
            }else{
                this.showNextElementOnOverlay();
            }
        }else{
            const tweetId = document.querySelector("article.is-selected-tweet")?.getAttribute('data-tweet-id');
            if(tweetId === null || tweetId === undefined){
                this.log("Could not find tweet ID");
                return;
            }
            this.mediaRequest(tweetId);
        }
    }
    
    public static initialize(){
        if(this.initialized){
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

    private static createImageOverlayElem(){
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
    
    private static addStyles(){
        
        GM_addStyle (`
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
    
    private static bindListeners(){
        document.addEventListener('keyup', (event) => {
            switch(event.key){
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


TweetdeckUtilities.initialize();