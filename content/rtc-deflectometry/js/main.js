'use strict';

// Button elements
const connectButton = document.querySelector('button#connect');
const requestImageButton = document.querySelector('button#requestImage');
const applyConstraintsButton = document.querySelector('button#applyConstraints');
const showPatternButton = document.querySelector('button#showPattern');

connectButton.onclick = connect;
requestImageButton.onclick = requestImage;
applyConstraintsButton.onclick = applyDesiredConstraints;
showPatternButton.onclick = showPattern;

// Settings control elements
const expSelector = document.getElementsByName('expCtrl');
const expCompSlider = document.querySelector('input[name="expCompSet"]');
const expCompValue = document.querySelector('output[id="expCompValue"]');
const expTimeSlider = document.querySelector('input[name="expTimeSet"]');
const expTimeValue = document.querySelector('output[id="expTimeValue"]');
const isoSlider = document.querySelector('input[name="isoSet"]');
const isoValue = document.querySelector('output[id="isoValue"]');
const focusSelector = document.getElementsByName('focusCtrl');
const focusSlider = document.querySelector('input[name="focusDistSet"]');
const focusValue = document.querySelector('output[id="focusDistValue"]');
const whtBalSelector = document.getElementsByName('whtBalCtrl');
const colorTempSlider = document.querySelector('input[name="colorTempSet"]');
const colorTempValue = document.querySelector('output[id="colorTempValue"]');
const zoomSlider = document.querySelector('input[name="zoomSet"]');
const zoomValue = document.querySelector('output[id="zoomValue"]');
const torchSelector = document.getElementsByName('torchCtrl');

// WebRTC features & elements
var supportedDevices = [];
var supportedConstraints;

var localStream;
var localImageCapture;
var localConstraints;
var localSettings;
var localCapabilities;
var remoteStream;
var remoteConstraints;
var remoteSettings;
var remoteCapabilities;

var imageSaveCount = 0;

var standardConstraints = 
{
    audio: false,
    video: 
    {
        deviceId:               "",

        width:                  {   min: 320,   ideal: 640,     max: 1920   },
        height:                 {   min: 240,   ideal: 480,     max: 1080   },
        frameRate:              {   min: 0,     ideal: 30,      max: 60     },

        facingMode:             {   ideal: "user"                           }
    }
};

// Displayed page elements
var remoteVideoCanvas = document.querySelector('video#inFeed');
var remoteImgs = document.querySelector('div#remoteImages');
var overlayDivs = [];

// Networking elements
var configuration = null;
var isInitiator;
var peerConn;
var dataChannel;

// Create a random room if not already present in the URL.
var room = window.location.hash.substring(1);
if (!room)
{
    room = window.location.hash = randomToken();
}

////////////////////////////// SOCKET.IO SIGNALS ///////////////////////////////

// Connect to the signaling server
var socket = io.connect();

socket.on('ipaddr', function(ipaddr)
{
    console.log('CLIENT: Server IP address -> ' + ipaddr);
});

socket.on('created', function(room, clientId)
{
    console.log('CLIENT: Created room -> ', room, ' | Client ID -> ', clientId);
    isInitiator = true;
});
  
socket.on('joined', function(room, clientId)
{
    console.log('CLIENT: Joined room -> ', room, ' | Client ID -> ', clientId);
    isInitiator = false;
});

socket.on('ready', function()
{
    console.log('CLIENT: Socket is ready.');
    if (isInitiator)    { connectButton.disabled = false; }
    else                { connectButton.disabled = true; }
});

socket.on('full', function(room)
{
    alert('CLIENT: Room ' + room + ' is full. We will create a new room for you.');
    window.location.hash = '';
    window.location.reload();
});

socket.on('message', function(message)
{
    console.log('CLIENT: Client received message -> ', message);
    signalingMessageCallback(message);
});

socket.on('imagerequest', function()
{
    console.log('CLIENT: Image request received. Sending image.');
    sendImage();
});

socket.on('log', function(array)
{
    console.log.apply(console, array);
});

socket.on('disconnect', function(reason)
{
    console.log(`CLIENT: Disconnected -> ${reason}.`);
    connectButton.disabled = false;
});

socket.on('bye', function(room)
{
    console.log(`CLIENT: Peer leaving room ${room}.`);

    // If peer did not create the room, re-enter to be creator.
    if (!isInitiator)
    {
        window.location.reload();
    }
});
  
function sendMessage(message)
//  TODO: Add function description.
{
    console.log('CLIENT: Client sending message -> ', message);
    socket.emit('message', message);
}

function signalingMessageCallback(message)
/**
  * TODO: Add function description.
  */
{
    if (message.type === 'offer')
    {
        console.log('CLIENT: Got offer. Sending answer to peer.');

        var desc = new RTCSessionDescription(message);

        connect();

        peerConn.setRemoteDescription(desc);
        peerConn.createAnswer(onLocalSessionCreated, logError);
    }
    else if (message.type === 'answer')
    {
        console.log('CLIENT: Got answer.');

        var desc = new RTCSessionDescription(message);

        peerConn.setRemoteDescription(desc);
    }
    else if (message.type === 'candidate')
    {
        peerConn.addIceCandidate(new RTCIceCandidate({ candidate: message.candidate }));
    }
}

///////////////////////////// STANDARD FUNCTIONS ///////////////////////////////

function connect()
//  TODO: Add function description.
{
    connectButton.disabled = true;
    createPeerConnection(isInitiator, configuration);
}

function startVideo()
//  TODO: Add function description.
{
    navigator.mediaDevices.getUserMedia(standardConstraints).then(gotStream).catch(handleError);
}

function stopVideo()
//  TODO: Add function description.
{
    localStream.getTracks().forEach(track => { track.stop(); });
}

function populateDeviceList(devices)
/**
  * TODO: Add function description.
  */
{
    for (let k = 0; k !== devices.length; ++k)
    {
        if (devices[k].kind === 'videoinput')   { supportedDevices.push(devices[k].deviceId); }
    }
    // (REMOVE COMMENT FOR DEBUG OUTPUT) console.log(`CLIENT : Supported video devices -> `, supportedDevices);

    // Update normal constraints with deviceID after the initial query
    standardConstraints.video.deviceId = supportedDevices[0];
}

function gotStream(stream)
/**
  * TODO: Add function description.
  */
{
    localStream = stream;

    var tempLocalVideo = document.createElement('video');
    tempLocalVideo.srcObject = localStream;
    tempLocalVideo.addEventListener('loadedmetadata', (e) =>
    {
        window.setTimeout(() => (getFeedback(localStream)), 500);
    });

    localImageCapture = new ImageCapture(localStream.getVideoTracks()[0]);

    // (REMOVE COMMENT FOR DEBUG OUTPUT) console.log(`CLIENT: Local stream listing ->`, localStream);
    // (REMOVE COMMENT FOR DEBUG OUTPUT) console.log(`CLIENT: Local track listing ->`, localStream.getVideoTracks()[0]);
    // (REMOVE COMMENT FOR DEBUG OUTPUT) console.log(`CLIENT: Local image capture ->`, localImageCapture);

    return localStream;
}

function requestImage()
/**
  * TODO: Add function description.
  */
{
    socket.emit('imagerequest');
}

function sendImage()
/**
  * TODO: Add function description.
  */
{
    localImageCapture.grabFrame().then(imageBitmap =>
    {
        // Local canvas for temporary image storage
        var canvas = document.createElement('canvas');
        canvas.width = 640;     // imageBitmap.width;
        canvas.height = 480;    // imageBitmap.height;
        canvas.getContext('2d').drawImage(imageBitmap, 0, 0, 640, 480);

        // Split data channel message in chunks of this byte length.
        var CHUNK_LEN = 64000;
        var img = canvas.getContext('2d').getImageData(0, 0, 640, 480);
        var len = img.data.byteLength;
        var n = len / CHUNK_LEN | 0;
    
        console.log('CLIENT: Sending a total of ' + len + ' byte(s).');
    
        if (!dataChannel)
        {
            logError('ERROR: Connection has not been initiated. Get two peers in the same room first!');
            return;
        }
        else if (dataChannel.readyState === 'closed')
        {
            logError('ERROR: Connection was lost. Peer closed the connection.');
            return;
        }
    
        dataChannel.send(len);
    
        // Split the photo and send in chunks of about 64KB
        for (var i = 0; i < n; i++)
        {
            var start = i * CHUNK_LEN,
            end = (i + 1) * CHUNK_LEN;
            console.log('CLIENT: ' + start + ' - ' + (end - 1));
            dataChannel.send(img.data.subarray(start, end));
        }
    
        // Send the remainder, if any
        if (len % CHUNK_LEN)
        {
            console.log('CLIENT: Last ' + len % CHUNK_LEN + ' byte(s).');
            dataChannel.send(img.data.subarray(n * CHUNK_LEN));
        }
    })
    .catch(err => console.error('CLIENT: grabFrame() error ->', err));
}

function renderIncomingPhoto(data)
/**
  * TODO: Add function description.
  */
{
    // Populating the Remote Image div
    var canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    canvas.classList.add('remoteImages');
    remoteImgs.insertBefore(canvas, remoteImgs.firstChild);
    
    var context = canvas.getContext('2d');
    var img = context.createImageData(640, 480);
    img.data.set(data);
    context.putImageData(img, 0, 0);

    // Saving the image
    let latestImg = remoteImgs.getElementsByTagName('canvas')[0];
    let dataURL = latestImg.toDataURL('image/png').replace("image/png", "image/octet-stream");

    let newImgLink = document.createElement('a');
    newImgLink.href = dataURL;
    newImgLink.download = "cam1_image" + imageSaveCount + ".png";
    newImgLink.click();

    // Update the global image counter (refreshes on load)
    imageSaveCount++;
}

function showPattern()
/**
  * TODO: Add function description.
  */
{
    var pattern = document.createElement('img');
    pattern.setAttribute('src', 'images/sin-pattern_f100_2048x1536.png');
    pattern.style.cssText = 'max-width: none;'
    pattern.addEventListener("click", function()
    {
        var closer = document.querySelector("div#overlay");
        closer.parentNode.removeChild(closer);

        if (document.cancelFullScreen)              { document.cancelFullScreen(); }
        else if (document.msCancelFullScreen)       { document.msCancelFullScreen(); }
        else if (document.mozCancelFullScreen)      { document.mozCancelFullScreen(); }
        else if (document.webkitCancelFullScreen)   { document.webkitCancelFullScreen(); }
    });

    var overlay = document.createElement('div');
    overlay.setAttribute("id", "overlay");
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; height: 100%; width: 100%; z-index:100;';
    overlay.appendChild(pattern);

    document.body.appendChild(overlay);

    if (document.documentElement.requestFullScreen)                 { document.documentElement.requestFullScreen(); }
    else if (document.documentElement.mozRequestFullScreen)         { document.documentElement.mozRequestFullScreen(); }
    else if (document.documentElement.webkitRequestFullScreen)      { document.documentElement.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT); }
}

function getFeedback(stream)
/**
  * TODO: Add function description.
  */
{
    let track = stream.getVideoTracks()[0];

    let constraints = track.getConstraints();
    console.log(`CLIENT: Track constraints ->`, constraints);

    let settings = track.getSettings();
    console.log(`CLIENT: Track settings ->`, settings);

    let capabilities = track.getCapabilities();
    console.log(`CLIENT: Track capabilities ->`, capabilities);

    // Using settings and capabilities to modify on-page controls - not all controls are supported!!!
    // You may add and remove these, as necessary. Make sure you update the constraints being passed
    // to track.applyConstraints() in order to reflect the added (or removed) controls.

    /* -------------------------- EXPOSURE CONTROL MODE ------------------------- */
    if ('exposureMode' in capabilities)
    {
        if      (settings.exposureMode === 'continuous')    { expSelector[0].checked = true; }
        else if (settings.exposureMode === 'manual')        { expSelector[1].checked = true; }

        for (var k = 0; k < expSelector.length; k++)
        {
            expSelector[k].disabled = false;
        }
    }
    else
    {
        console.log('CLIENT: Exposure control is not supported by ' + track.label);
    }

    /* ---------------------- EXPOSURE COMPENSATION SETTING --------------------- */
    if ('exposureCompensation' in capabilities)
    {
        expCompSlider.min = capabilities.exposureCompensation.min;
        expCompSlider.value = settings.exposureCompensation.value;
        expCompSlider.max = capabilities.exposureCompensation.max;
        expCompSlider.step = capabilities.exposureCompensation.step;
        expCompValue.innerHTML = expCompSlider.value;

        expCompSlider.oninput = function(event) { expCompValue.innerHTML = event.target.value; }

        expCompSlider.disabled = false;
    }
    else
    {
        expCompSlider.value = 0;
        console.log('CLIENT: Exposure compensation adjustment is not supported by ' + track.label);
    }

    /* ------------------------- EXPOSURE TIME SETTING -------------------------- */
    if ('exposureTime' in capabilities)
    {
        expTimeSlider.min = capabilities.exposureTime.min;
        expTimeSlider.value = settings.exposureTime.value;
        expTimeSlider.max = capabilities.exposureTime.max;
        expTimeSlider.step = capabilities.exposureTime.step;
        expTimeValue.innerHTML = expTimeSlider.value;

        expTimeSlider.oninput = function(event) { expTimeValue.innerHTML = event.target.value; }

        expTimeSlider.disabled = false;
    }
    else
    {
        expTimeSlider.value = 0;
        console.log('CLIENT: Exposure time adjustment is not supported by ' + track.label);
    }

    /* ------------------------------- ISO SETTING ------------------------------ */
    if ('iso' in capabilities)
    {
        isoSlider.min = capabilities.iso.min;
        isoSlider.value = settings.iso.value;
        isoSlider.max = capabilities.iso.max;
        isoSlider.step = capabilities.iso.step;
        isoValue.innerHTML = isoSlider.value;

        isoSlider.oninput = function(event) { isoValue.innerHTML = event.target.value; }

        isoSlider.disabled = false;
    }
    else
    {
        isoSlider.value = 0;
        console.log('CLIENT: ISO adjustment is not supported by ' + track.label);
    }

    /* ------------------------- FOCUS CONTROL SELECTION ------------------------ */
    if ('focusMode' in capabilities)
    {
        if      (settings.focusMode === 'continuous')   { focusSelector[0].checked = true; }
        else if (settings.focusMode === 'single-shot')  { focusSelector[1].checked = true; }
        else if (settings.focusMode === 'manual')       { focusSelector[2].checked = true; }

        for (var k = 0; k < focusSelector.length; k++)
        {
            focusSelector[k].disabled = false;
        }
    }
    else
    {
        console.log('CLIENT: Focus control is not supported by ' + track.label);
    }

    /* ------------------------- FOCUS DISTANCE SETTING ------------------------- */
    if ('focusDistance' in capabilities)
    {
        focusSlider.min = capabilities.focusDistance.min;
        focusSlider.value = settings.focusDistance.value;
        focusSlider.max = capabilities.focusDistance.max;
        focusSlider.step = capabilities.focusDistance.step;
        focusValue.innerHTML = focusSlider.value;

        focusSlider.oninput = function(event) { focusValue.innerHTML = event.target.value; }

        focusSlider.disabled = false;
    }
    else
    {
        focusSlider.value = 0;
        console.log('CLIENT: Focal distance adjustment is not supported by ' + track.label);
    }

    /* ----------------------- WHITE BALANCE CONTROL MODE ----------------------- */
    if ('whiteBalanceMode' in capabilities)
    {
        if      (settings.whiteBalanceMode === 'continuous')    { whtBalSelector[0].checked = true; }
        else if (settings.whiteBalanceMode === 'manual')        { whtBalSelector[1].checked = true; }
        else if (settings.whiteBalanceMode === 'none')          { whtBalSelector[2].checked = true; }

        for (var k = 0; k < whtBalSelector.length; k++)
        {
            whtBalSelector[k].disabled = false;
        }
    }
    else
    {
        console.log('CLIENT: White balance control is not supported by ' + track.label);
    }

    /* ----------------------- COLOR TEMPERATURE SETTING ------------------------ */
    if ('colorTemperature' in capabilities)
    {
        colorTempSlider.min = capabilities.colorTemperature.min;
        colorTempSlider.value = settings.colorTemperature.value;
        colorTempSlider.max = capabilities.colorTemperature.max;
        colorTempSlider.step = capabilities.colorTemperature.step;
        colorTempValue.innerHTML = colorTempSlider.value;

        colorTempSlider.oninput = function(event) { colorTempValue.innerHTML = event.target.value; }

        colorTempSlider.disabled = false;
    }
    else
    {
        colorTempSlider.value = 0;
        console.log('CLIENT: Color temperature adjustment is not supported by ' + track.label);
    }

    /* ------------------------------ ZOOM SETTING ------------------------------ */
    if ('zoom' in capabilities)
    {
        zoomSlider.min = capabilities.zoom.min;
        zoomSlider.value = settings.zoom;
        zoomSlider.max = capabilities.zoom.max;
        zoomSlider.step = capabilities.zoom.step;
        zoomValue.innerHTML = zoomSlider.value;

        zoomSlider.oninput = function(event) { zoomValue.innerHTML = event.target.value; }

        zoomSlider.disabled = false;
    }
    else
    {
        zoomSlider.value = 0;
        console.log('CLIENT: Zoom is not supported by ' + track.label);
    }

    /* ------------------------------ TORCH SETTING ----------------------------- */
    if ('torch' in capabilities)
    {
        if      (settings.torch === false)  { torchSelector[0].checked = true; }
        else if (settings.torch === true)   { torchSelector[1].checked = true; }

        for (var k = 0; k < torchSelector.length; k++)
        {
            torchSelector[k].disabled = false;
        }
    }
    else
    {
        console.log('CLIENT: Torch control is not supported by ' + track.label);
    }

    applyConstraintsButton.disabled = false;
}

function applyDesiredConstraints()
/**
  * TODO: Add function description.
  */
{
    let track = localStream.getVideoTracks()[0];
    let newConstraints = { advanced: [{}] };

    // Conditionals to check the status of the radio buttons before plugging them into the constraints applicator.
    /* -------------- EXPOSURE CONTROL, COMPENSATION, TIME SETTINGS ------------- */
    if (document.getElementsByName('expCtrl')[0].checked)
    {
        newConstraints.advanced[0].exposureMode = "continuous";
    }
    else if (document.getElementsByName('expCtrl')[1].checked)
    {
        newConstraints.advanced[0].exposureMode = "manual";
        newConstraints.advanced[0].exposureCompensation = expCompSlider.value;
    }

    /* ------------------------------- ISO SETTING ------------------------------ */
    if (isoSlider.disabled === false)
    {
        newConstraints.advanced[0].iso = isoSlider.value;
    }

    /* -------------------- FOCUS CONTROL, DISTANCE SETTINGS -------------------- */
    if (document.getElementsByName('focusCtrl')[0].checked)
    {
        newConstraints.advanced[0].focusMode = "continuous";
    }
    else if (document.getElementsByName('focusCtrl')[1].checked)
    {
        newConstraints.advanced[0].focusMode = "single-shot";
    }
    else if (document.getElementsByName('focusCtrl')[2].checked)
    {
        newConstraints.advanced[0].focusMode = "manual";
        newConstraints.advanced[0].focusDistance = focusSlider.value;
    }

    /* ---------------- WHITE BALANCE, COLOR TEMPERATURE SETTINGS --------------- */
    if (document.getElementsByName('whtBalCtrl')[0].checked)
    {
        newConstraints.advanced[0].whiteBalanceMode = "continuous";
    }
    else if (document.getElementsByName('whtBalCtrl')[1].checked)
    {
        newConstraints.advanced[0].whiteBalanceMode = "manual";
        newConstraints.advanced[0].colorTemperature = colorTempSlider.value;
    }

    /* ------------------------------ ZOOM SETTING ------------------------------ */
    if (zoomSlider.disabled === false)
    {
        newConstraints.advanced[0].zoom = zoomSlider.value;
    }

    /* ----------------------------- TORCH CONTROLS ----------------------------- */
    if (document.getElementsByName('torchCtrl')[0].checked)
    {
        newConstraints.advanced[0].torch = "false";
    }
    else if (document.getElementsByName('torchCtrl')[1].checked)
    {
        newConstraints.advanced[0].torch = "true";
    }


    track.applyConstraints(newConstraints).then(function()
    {
        console.log('CLIENT: Newly applied constraints -> ', newConstraints);

        // Updated details
        console.log(`CLIENT: Updated track constraints ->`, track.getConstraints());
        console.log(`CLIENT: Updated track settings ->`, track.getSettings());
        console.log(`CLIENT: Updated track capabilities ->`, track.getCapabilities());
    })
    .catch(handleError);
}

/////////////////////////////// UTILITY FUNCTIONS //////////////////////////////

function randomToken()
/**
  * TODO: Add function description.
  */
{
    return Math.floor((1 + Math.random()) * 1e16).toString(16).substring(1);
}

function handleError(error)
/**
  * TODO: Add function description.
  */
{
    const message = `CLIENT: Error ->  ${error.name} : ${error.message}`;

    alert(message);
    console.log(message);
    startVideoButton.disabled = false;
}

function logError(err)
/**
  * TODO: Add function description.
  */
{
    if (!err) return;

    if (typeof err === 'string')
    {
        console.warn(err);
    } 
    else
    {
        console.warn(err.toString(), err);
    }
}

//////////////////////// \/ INITIALIZER BEGINS HERE \/ /////////////////////////

// Initial gUM scan
navigator.mediaDevices.getUserMedia({ audio: false, video: true }).then(function()
{
        supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
        console.log(`CLIENT : Local supported constraints -> `, supportedConstraints);

        navigator.mediaDevices.enumerateDevices().then(populateDeviceList).then(function()
        {
            startVideo();
        });
})
.catch(handleError);

if (location.hostname.match(/localhost|127\.0\.0/))
{
    socket.emit('ipaddr');
}

window.addEventListener('unload', function()
{
    console.log(`CLIENT: Unloading window. Notifying peers in ${room}.`);
    socket.emit('bye', room);
});

socket.emit('create or join', room);