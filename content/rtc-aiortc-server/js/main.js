/**
  * TODO: Add file description
  */

'use strict';

// Standard constants and variables
var previewVideoHidden = false;

// Button elements
const connectButton = document.querySelector('button#connect');
const disconnectButton = document.querySelector('button#disconnect');
const toggleVideoButton = document.querySelector('button#toggleVideo');
const showWhiteButton = document.querySelector('button#showWhiteImage');
const showBlackButton = document.querySelector('button#showBlackImage');
const showFringePatternButton = document.querySelector('button#showFringePattern');
const showLinePatternButton = document.querySelector('button#showLinePattern');

connectButton.onclick = connect;
disconnectButton.onclick = disconnect;
toggleVideoButton.onclick = toggleVideoState;
showWhiteButton.onclick = function()
{
    enterFullscreenState();
    initPattern(0);
}
showBlackButton.onclick = function()
{
    enterFullscreenState();
    initPattern(1);
}
showFringePatternButton.onclick = function()
{
    enterFullscreenState();
    initPattern(2);
}
showLinePatternButton.onclick = function()
{
    enterFullscreenState();
    initPattern(4);
}

const sendImageButton = document.querySelector('button#sendImage');
sendImageButton.onclick = function()
{
    sendImage();
}

// WebRTC features & elements
var peerConn;
var dataChannel;

var supportedConstraints;
var videoDevices = [];
var remoteVideoDiv = document.querySelector('div#videoFeeds');
var remoteVideoCanvas = document.querySelector('video#loopback');

var localStream;
var localImageCapture;

// Deflectometry-specific variables and elements
var localPhotoSettings = 
{ 
    imageHeight:        1080,           // Resolution forced to fit the 
    imageWidth:         1440,           // Shield tablet capabilities
};

var pattern;
var overlay;
var calibPixValue = 0;
var frequencyArray = [ 1, 2, 2.5, 3, 3.5, 5 ];              // Change this array to introduce other frequencies.
var targetType = 0;
var targetFrequency = 10;
var targetPhaseShift = 0;
var measurementLineWidth = 10;                              // Change this integer to modify the size of the lines (NOT fringes) projected in the measurement process.
var lensHousingOffset = 100;                                // Change (or comment out the value assignment for) this integer to adjust the black bar size on the left of the Shield tablet.

var calibInterval;
var sequenceInterval;
var sequenceCounter = 0;
var imageSendCounter = 0;

///////////////////////////// STANDARD FUNCTIONS ///////////////////////////////

function initialize()
/**
  * First function to run when the browser executes JavaScript code in the window.
  * 
  * This calls getUserMedia() so we can interact with and fetch information about
  * device constraints and capabilities, send a video stream to the other client,
  * etc.
  */
{
    // Recover constrainable properties supported by the browser
    supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
    console.log(`CLIENT : Local supported constraints -> `, supportedConstraints);

    // Window shutdown handler
    window.addEventListener('unload', function() { console.log(`CLIENT: Unloading window.`); });
}

function connect()
//  Primary function, tied to a button element, that initiates getUserMedia and then
//  establishes a WebRTC peer connection.
{
    connectButton.disabled = true;

    navigator.mediaDevices.enumerateDevices().then(function(devices)
    {
        for (let k = 0; k !== devices.length; ++k)
        {
            if (devices[k].kind === 'videoinput')   { videoDevices.push(devices[k].deviceId); }
        }
        console.log(`CLIENT : Local video devices -> `, videoDevices);

        // Initial gUM scan
        navigator.mediaDevices.getUserMedia({video: {deviceId: videoDevices[0]}}).then(function(stream)
        {
            // Bind to global variables
            localStream = stream;
            localImageCapture = new ImageCapture(localStream.getVideoTracks()[0]);

            // Create the WebRTC peer connection
            createPeerConnection();

            // Finalize peer connection to server
            negotiatePeerConnection();
        })
        .catch(function(err)
        {
            alert(err);
        });
    });

    disconnectButton.disabled = false;
}

function disconnect()
// Function that severs the RTCPeerConnection after gracefully stopping other parts
// of the system.
{
    disconnectButton.disabled = true;

    // Terminate data channel
    if (dataChannel)    { dataChannel.close(); }

    // Stop local video
    remoteVideoCanvas.srcObject = null;
    peerConn.getSenders().forEach(function(sender) { sender.track.stop(); });

    // Close peer connection
    setTimeout(function() { peerConn.close(); }, 500);

    connectButton.disabled = false;
}

function toggleVideoState()
//  Function tied to a button that hides the remote video preview element on the
//  local webpage.
{
    previewVideoHidden = !previewVideoHidden;

    if (previewVideoHidden) { remoteVideoDiv.style.display = "none"; }
    else                    { remoteVideoDiv.style.display = "block"; }
}

function enterFullscreenState()
//  Function tied to a button that requests the browser be placed into fullscreen mode.
{
    if      (document.documentElement.requestFullScreen)            { document.documentElement.requestFullScreen(); }
    else if (document.documentElement.mozRequestFullScreen)         { document.documentElement.mozRequestFullScreen(); }
    else if (document.documentElement.webkitRequestFullScreen)      { document.documentElement.webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT); }
}

function exitFullScreenState()
//  Function tied to a button that requests the browser exit fullscreen mode and return
//  to its normal display configuration.
{
    if      (document.cancelFullScreen)         { document.cancelFullScreen(); }
    else if (document.msCancelFullScreen)       { document.msCancelFullScreen(); }
    else if (document.mozCancelFullScreen)      { document.mozCancelFullScreen(); }
    else if (document.webkitCancelFullScreen)   { document.webkitCancelFullScreen(); }
}

function sendImage()
/**
  * This function is called whenever images are requested from a remote server or as part
  * of a dedicated capture sequence. Capturing images via the ImageCapture API, repacking
  * them, and sending them across the RTCDataChannel is all combined into this function.
  * 
  * The RTCDataChannel should be an established part of the RTCPeerConnection in order to
  * successfully transmit image data across the connection. Note that these images are
  * intentionally not compressed or sent via other methods to preserve all of the image
  * data.
  */
{
    localImageCapture.takePhoto(localPhotoSettings).then(imgBlob =>
    {
        socket.emit('photo_dimensions', localPhotoSettings.imageWidth, localPhotoSettings.imageHeight);

        // Generate an image from the blob
        var tempImage = document.createElement('img');
        tempImage.src = URL.createObjectURL(imgBlob);

        tempImage.onload = function()
        {
            // Local canvas for temporary storage
            var canvas = document.createElement('canvas');
            canvas.width = localPhotoSettings.imageWidth;
            canvas.height = localPhotoSettings.imageHeight;
            canvas.getContext('2d').drawImage(tempImage, 0, 0, canvas.width, canvas.height);

            // Split data channel message in chunks of this byte length.
            var bytesSent = 0;
            var chunkLength = 64000;
            var sendDelay = 100;
            var intervalID = 0;

            var img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
            var len = img.data.byteLength;

            if (!dataChannel)
            {
                handleError('CLIENT: ERROR! Connection has not been initiated.!');
                return;
            }
            else if (dataChannel.readyState === 'closed')
            {
                handleError('ERROR: Connection was lost. Peer closed the connection.');
                return;
            }
            
            console.log('CLIENT: Sending a total of ' + len + ' byte(s) for image # ' + imageSendCounter);

            intervalID = setInterval(function()
            {
                var msgStart = bytesSent;
                var msgEnd = bytesSent + chunkLength;

                if (msgEnd > len)
                {
                    msgEnd = len;
                    console.log('CLIENT: Last ' + len % chunkLength + ' byte(s) in queue.');
                    clearInterval(intervalID);
                }
                else 
                {
                    console.log('CLIENT: Sending bytes ' + msgStart + ' - ' + (msgEnd - 1));
                }

                dataChannel.send(img.data.subarray(msgStart, msgEnd));
                bytesSent = msgEnd;
            }, sendDelay);
        }
    })
    .then(function()
    {
        imageSendCounter++;
    })
    .catch(err => console.error('CLIENT: takePhoto() error ->', err));
}

///////////////////////////// SOCKET.IO FUNCTIONS //////////////////////////////

var socket = io();

socket.on('image_request', function()
{
    console.log('CLIENT: Received request to send a single image. Sending one image now...');
    sendImage();
});

socket.on('calib_request', function()
{
    console.log('CLIENT: Received request to start calibration sequence. Starting calibration sequence now...');
    imageSendCounter = 0;
    calibInterval = setInterval(cycleCalibration, 10000);
});

socket.on('sequence_request', function()
{
    console.log('CLIENT: Received request to start capture sequence. Starting capture sequence now...');
    imageSendCounter = 0;
    sequenceInterval = setInterval(cyclePattern, 10000);
});


/////////////////////////////// WEBRTC FUNCTIONS ///////////////////////////////

function createPeerConnection()
/**
  * Upon connection request, each client must negotiate their end of the WebRTC peer
  * connection. Additionally, video track information (taken from an active video stream
  * on the client side) needs to be added to the peer connection.
  * 
  * A number of other utility functions are used to facilitate the setup of the peer
  * connection and the data channel interface.
  */
{
    // Build out the peerConnection & dataChannel
    peerConn = new RTCPeerConnection();

    dataChannel = peerConn.createDataChannel('images');
    dataChannel.onopen = function() { console.log('CLIENT: Data channel opened!'); };
    dataChannel.onclose = function() { console.log('CLIENT: Data channel closed!'); };

    // Add the local video track to the peerConnection
    peerConn.addTrack(localStream.getVideoTracks()[0], localStream);

    // Create a handler for when the peer connection gets a video track added to it (remotely)
    peerConn.ontrack = function(event)
    {
        if (!remoteVideoCanvas.srcObject)    { remoteVideoCanvas.srcObject = event.streams[0]; }
    };
}

function negotiatePeerConnection()
/**
  * TODO: Add function description.
  */
{
    return peerConn.createOffer().then(function(offer)
    {
        return peerConn.setLocalDescription(offer);
    })
    .then(function()
    {
        return new Promise(function(resolve)
        {
            if (peerConn.iceGatheringState === 'complete')  { resolve(); }
            else
            {
                function checkState()
                {
                    if (peerConn.iceGatheringState === 'complete')
                    {
                        peerConn.removeEventListener('icegatheringstatechange', checkState);
                        resolve();
                    }
                }
                peerConn.addEventListener('icegatheringstatechange', checkState);
            }
        });
    })
    .then(function()
    {
        var offer = peerConn.localDescription;

        console.log(offer);

        return fetch('/offer',
        {
            body: JSON.stringify({sdp: offer.sdp, type: offer.type}),
            headers:{'Content-Type': 'application/json'},
            method: 'POST'
        });
    })
    .then(function(response)
    {
        return response.json();
    })
    .then(function(answer)
    {
        return peerConn.setRemoteDescription(answer);
    })
    .catch(function(err)
    {
        alert(err);
    });
}

//////////////////////////// DEFLECTOMETRY FUNCTIONS ///////////////////////////

function initPattern(patSwitch)
/**
  * Before showing any custom, full-white, or full-black pattern, the (now) full-screen
  * browser must have a new canvas element that sits over top of the normally displayed
  * webpage. This canvas is created and destroyed as full-screen is enabled and disabled,
  * so that the website remains usable.
  * 
  * patSwitch allows the calling entity to decide what kind of pattern is to be displayed
  * when the full-screen canvas element is initialized. Regardless of pattern being
  * displayed, calibration or measurement sequences can be called at any time.
  */
{
    // Overlay setup
    overlay = document.createElement('div');
    overlay.setAttribute("id", "overlay");
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; height: 100%; width: 100%; z-index:100;';

    // Pattern setup
    pattern = document.createElement('canvas');
    pattern.width = effScreenWidth;
    pattern.height = effScreenHeight;
    pattern.style.cssText = 'max-width: none; max-height: none';

    // Add a listener to escape the FullScreen status (requires an overlay w/ pattern to work properly)
    pattern.addEventListener("click", function()
    {
        var cleaner = document.querySelector("div#overlay");
        cleaner.parentNode.removeChild(cleaner);
        
        exitFullScreenState();

        clearInterval(sequenceInterval);
        clearInterval(calibInterval);

        targetType = 0;
        targetPhaseShift = 0;
        targetFrequency = 0;
        sequenceCounter = 0;
        imageSendCounter = 0;
    });

    // Selection of pattern to display
    if      (patSwitch === 1)   { showPattern(1, 0, 0); }           // Display a black pattern
    else if (patSwitch === 2)   { showPattern(2, 10, 0); }          // Display a vertical fringe pattern, locked to 10 cycles
    else if (patSwitch === 4)   { showPattern(4, 2, Math.PI); }     // Display a vertical line pattern, with 2 lines shifted some amount
    else                        { showPattern(0, 0, 0); }           // Display a white pattern
    
    // Posting the pattern to the overlay
    overlay.appendChild(pattern);
    document.body.appendChild(overlay);
}

function showPattern(type, frequency, phaseShift)
/**
  * Conditional display function. Pattern is a global variable that corresponds to
  * the full-screen element that will display the requested pattern with the specified
  * characteristics.
  */
{
    var patCtx = pattern.getContext('2d');
    var patData;

    if      (type === 1)    { patData = generateBlackPattern(patCtx, effScreenWidth, effScreenHeight); }
    else if (type === 2)    { patData = generateVerticalFringePattern(patCtx, effScreenWidth, effScreenHeight, window.devicePixelRatio, frequency, phaseShift); }
    else if (type === 3)    { patData = generateHorizontalFringePattern(patCtx, effScreenWidth, effScreenHeight, window.devicePixelRatio, frequency, phaseShift); }
    else if (type === 4)    { patData = generateVerticalLinePattern(patCtx, effScreenWidth, effScreenHeight, window.devicePixelRatio, frequency, phaseShift); }
    else if (type === 5)    { patData = generateHorizontalLinePattern(patCtx, effScreenWidth, effScreenHeight, window.devicePixelRatio, frequency, phaseShift); }
    else if (type === 98)   { patData = generateCalibPattern(patCtx, effScreenWidth, effScreenHeight); }
    else                    { patData = generateWhitePattern(patCtx, effScreenWidth, effScreenHeight); }

    patCtx.putImageData(patData, 0, 0);
}

function generateWhitePattern(context, width, height)
/**
  * Deflectometry-specific full white screen generation function. This returns an object
  * that has can be used in the deflectometry calibration sequence or as a part of a
  * customized measurement sequence.
  * 
  * NOTE: lensHousingOffset MUST exist to avoid any uncaught exceptions when this function
  * triggers, but the conditional will not fire if the value isn't set (or explicitly
  * assigned to NULL).
  * 
  * ALSO NOTE: Vertical and horizontal ranges are different due to the addressing scheme
  * for changing pixel data values on a color display.
  */
{
    var hStart = 0;
    var vStart = 0;
    var patternData = generateBlackPattern(context, width, height);

    if (lensHousingOffset)
    {
        hStart = lensHousingOffset * 4;
    }

    for (var i = hStart; i < (width * 4); i += 4)
    {
        for (var k = vStart; k < height; k += 1)
        {
            patternData.data[(4*k*width)+i+0] = 255;
            patternData.data[(4*k*width)+i+1] = 255;
            patternData.data[(4*k*width)+i+2] = 255;
            patternData.data[(4*k*width)+i+3] = 255;
        }
    }

    return patternData;
}

function generateBlackPattern(context, width, height)
/**
  * Deflectometry-specific full black screen generation function. This returns an object
  * that has can be used in the deflectometry calibration sequence or as a part of a
  * customized measurement sequence.
  * 
  * NOTE: lensHousingOffset MUST exist to avoid any uncaught exceptions when this function
  * triggers, but the conditional will not fire if the value isn't set (or explicitly
  * assigned to NULL).
  * 
  * ALSO NOTE: Vertical and horizontal ranges are different due to the addressing scheme
  * for changing pixel data values on a color display.
  */
{
    var hStart = 0;
    var vStart = 0;
    var patternData = context.createImageData(width, height);

    // NOTE: No lens housing compensation code, always creating a totally black screen.

    for (var i = hStart; i < (width * 4); i += 4)
    {
        for (var k = vStart; k < height; k += 1)
        {
            patternData.data[(4*k*width)+i+0] = 0;
            patternData.data[(4*k*width)+i+1] = 0;
            patternData.data[(4*k*width)+i+2] = 0;
            patternData.data[(4*k*width)+i+3] = 255;
        }
    }

    return patternData;
}

function generateVerticalFringePattern(context, width, height, ratio, frequency, phaseShift)
/**
  * Deflectometry-specific vertical (when viewed in landscape mode) fringe synthesis
  * function. This returns an pattern that has continuous, sinusoidal shape that is displayed
  * (and shifted) in order to measure the surface normals of an object under test.
  * Several parameters can be changed, either through the function call, or through
  * global variables, to change the data returned by this function.
  * 
  * NOTE: lensHousingOffset MUST exist to avoid any uncaught exceptions when this function
  * triggers, but the conditional will not fire if the value isn't set (or explicitly
  * assigned to NULL).
  * 
  * ALSO NOTE: Vertical and horizontal ranges are different due to the addressing scheme
  * for changing pixel data values on a color display.
  */
{
    var hStart = 0;
    var vStart = 0;
    var patternData = generateBlackPattern(context, width, height);
    var value = 0;

    if (lensHousingOffset)
    {
        hStart = lensHousingOffset * 4;
    }

    for (var i = hStart; i < (width * 4); i += 4)
    {
        value = ((127.5 * Math.sin((2 * Math.PI * frequency * i * ratio / (width * 4)) + phaseShift)) + 127.5);
        
        for (var k = vStart; k < height; k += 1)
        {
            patternData.data[(4*k*width)+i+0] = value;
            patternData.data[(4*k*width)+i+1] = value;
            patternData.data[(4*k*width)+i+2] = value;
            patternData.data[(4*k*width)+i+3] = 255;
        }
    }

    return patternData;
}

function generateHorizontalFringePattern(context, width, height, ratio, frequency, phaseShift)
/**
  * Deflectometry-specific horizontal (when viewed in landscape mode) fringe synthesis
  * function. This returns an pattern that has continuous, sinusoidal shape that is displayed
  * (and shifted) in order to measure the surface normals of an object under test.
  * Several parameters can be changed, either through the function call, or through
  * global variables, to change the data returned by this function.
  * 
  * NOTE: lensHousingOffset MUST exist to avoid any uncaught exceptions when this function
  * triggers, but the conditional will not fire if the value isn't set (or explicitly
  * assigned to NULL).
  * 
  * ALSO NOTE: Vertical and horizontal ranges are different due to the addressing scheme
  * for changing pixel data values on a color display.
  */
{
    var hStart = 0;
    var vStart = 0;
    var patternData = generateBlackPattern(context, width, height);
    var value = 0;

    if (lensHousingOffset)
    {
        hStart = lensHousingOffset * 4;
    }

    for (var k = vStart; k < height; k += 1)
    {
        value = ((127.5 * Math.sin((2 * Math.PI * frequency * k * ratio / width) + phaseShift)) + 127.5);

        for (var i = hStart; i < (width * 4); i += 4)
        {
            patternData.data[(4*k*width)+i+0] = value;
            patternData.data[(4*k*width)+i+1] = value;
            patternData.data[(4*k*width)+i+2] = value;
            patternData.data[(4*k*width)+i+3] = 255;
        }
    }

    return patternData;
}

function generateVerticalLinePattern(context, width, height, ratio, frequency, phaseShift)
/**
  * Deflectometry-specific vertical (when viewed in landscape mode) line synthesis function.
  * This returns an object that is displayed (and shifted) in order to measure the surface
  * normals of an object under test. Several parameters can be changed, either through the
  * function call, or through global variables, to change the data returned by this function.
  * 
  * NOTE: lensHousingOffset MUST exist to avoid any uncaught exceptions when this function
  * triggers, but the conditional will not fire if the value isn't set (or explicitly
  * assigned to NULL).
  * 
  * ALSO NOTE: Vertical and horizontal ranges are different due to the addressing scheme
  * for changing pixel data values on a color display.
  */
{
    var hStart = 0;
    var vStart = 0;
    var lineSpan = width / (frequency * ratio);
    var patternData = generateBlackPattern(context, width, height);

    if (lensHousingOffset)
    {
        hStart = lensHousingOffset * 4;
    }

    for (var count = 0; count < frequency; ++count)
    {
        var linePos = Math.round((count * lineSpan) + ((phaseShift / (2 * Math.PI)) * lineSpan));

        var lineStart = linePos * 4;
        var lineEnd = lineStart + (4 * measurementLineWidth);

        if (lineStart < hStart)
        {
            continue;
        }
        else
        {
            for (var i = lineStart; i < lineEnd; i += 4)
            {
                for (var k = vStart; k < height; ++k)
                {
                    patternData.data[(4*k*width)+i+0] = 255;
                    patternData.data[(4*k*width)+i+1] = 255;
                    patternData.data[(4*k*width)+i+2] = 255;
                    patternData.data[(4*k*width)+i+3] = 255;
                }
            }
        }
    }

    return patternData;
}

function generateHorizontalLinePattern(context, width, height, ratio, frequency, phaseShift)
/**
  * Deflectometry-specific horizontal (when viewed in landscape mode) line synthesis function.
  * This returns an object that is displayed (and shifted) in order to measure the surface
  * normals of an object under test. Several parameters can be changed, either through the
  * function call, or through global variables, to change the data returned by this function.
  * 
  * NOTE: lensHousingOffset MUST exist to avoid any uncaught exceptions when this function
  * triggers, but the conditional will not fire if the value isn't set (or explicitly
  * assigned to NULL).
  * 
  * ALSO NOTE: Vertical and horizontal ranges are different due to the addressing scheme
  * for changing pixel data values on a color display.
  */
{
    var vStart = 0;
    var lineSpan = height / (frequency * ratio);
    var patternData = generateBlackPattern(context, width, height);

    if (lensHousingOffset)
    {
        vStart = lensHousingOffset * 4;
    }

    for (var count = 0; count < frequency; ++count)
    {
        var linePos = Math.round((count * lineSpan) + ((phaseShift / (2 * Math.PI)) * lineSpan));

        var lineStart = linePos;
        var lineEnd = lineStart + (measurementLineWidth);

        for (var i = lineStart; i < lineEnd; ++i)
        {
            for (var k = vStart; k < (width * 4); k += 4)
            {
                patternData.data[(4*i*width)+k+0] = 255;
                patternData.data[(4*i*width)+k+1] = 255;
                patternData.data[(4*i*width)+k+2] = 255;
                patternData.data[(4*i*width)+k+3] = 255;
            }
        }
    }

    return patternData;
}

function generateCalibPattern(context, width, height)
/**
  * Deflectometry-specific calibration pattern generation function. This returns an object
  * that has specific relevance to the deflectometry calibration sequence.
  * 
  * NOTE: lensHousingOffset MUST exist to avoid any uncaught exceptions when this function
  * triggers, but the conditional will not fire if the value isn't set (or explicitly
  * assigned to NULL).
  * 
  * ALSO NOTE: Vertical and horizontal ranges are different due to the addressing scheme
  * for changing pixel data values on a color display.
  */
{
    var hStart = 0;
    var vStart = 0;
    var patternData = generateBlackPattern(context, width, height);

    if (lensHousingOffset)
    {
        hStart = lensHousingOffset * 4;
    }

    for (var i = hStart; i < (width * 4); i += 4)
    {
        for (var k = vStart; k < height; k += 1)
        {
            patternData.data[(4*k*width)+i+0] = calibPixValue;
            patternData.data[(4*k*width)+i+1] = calibPixValue;
            patternData.data[(4*k*width)+i+2] = calibPixValue;
            patternData.data[(4*k*width)+i+3] = 255;
        }
    }

    if (calibPixValue === 0)    { calibPixValue += 15; }
    else                        { calibPixValue += 16; }

    if (calibPixValue > 255)    { calibPixValue = 255; }

    return patternData;
}

///////////////////////////// MEASUREMENT SEQUENCES ////////////////////////////

function cycleCalibration()
/**
  * This function is a variation on the measurement sequence that instead shows the
  * calibration pattern. The calibration pattern values will update inside the
  * generateCalibPattern() function, so all that is required is to check for when
  * the calibration sequence is complete.
  */
{
    showPattern(98, 0, 0);

    setTimeout(function()
    {
        socket.emit('sequence_data', 98, 0, imageSendCounter);

        sendImage();
        imageSendCounter++;

        if (calibPixValue === 255)      // End of capture condition for the calibration sequence.
        {
            imageSendCounter = 0;
            calibPixValue = 0;

            clearInterval(calibInterval);
            setTimeout(function() { showPattern(1, 0, 0); }, 500);
        }
    }, 1000);
}

function cyclePattern()
/**
  * Once a measurement sequence is requested, this function will display a new pattern
  * made with the current set of variables, change the variables for the next pass, and
  * set a timer for a function that captures data (so changing the display and 
  * capturing new data isn't simultaneous) and checks to see if the sequence is finished.
  * 
  * Change the integer at the end of setTimeout() to adjust how long of a delay exists
  * between pattern changing and image data being captured.
  */
{
    targetFrequency = frequencyArray[sequenceCounter];

    showPattern(targetType, targetFrequency, targetPhaseShift);

    targetPhaseShift += (Math.PI / 2);

    setTimeout(function()
    {
        socket.emit('sequence_data', targetType, targetFrequency, imageSendCounter);

        sendImage();
        imageSendCounter++;

        if (imageSendCounter === 4)                               // End of capture sequence for a particular frequency
        {
            imageSendCounter = 0;
            targetPhaseShift = 0;

            sequenceCounter++;
            if (sequenceCounter === frequencyArray.length)      // End of capture sequence for all frequencies in a particular type group
            {
                if (targetType === 1)                           // End of capture sequence for all types
                {
                    targetType = 0;
                    clearInterval(sequenceInterval);
                    setTimeout(function() { showPattern(1, 0, 0); }, 500);
                }

                sequenceCounter = 0;
                targetType++;
            }
        }
    }, 1000);
}