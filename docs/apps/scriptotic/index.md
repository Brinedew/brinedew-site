---
title: Scriptotic - YouTube Transcript Generator
---

<style>
/* Scriptotic App Styles */
.scriptotic-container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
}

.form-group {
    margin-bottom: 20px;
}

.form-group label {
    display: block;
    margin-bottom: 8px;
    font-weight: 500;
    color: var(--md-default-fg-color);
}

.form-group input[type="url"], 
.form-group input[type="text"], 
.form-group select {
    width: 100%;
    padding: 12px;
    border: 2px solid var(--md-default-fg-color--lighter);
    border-radius: 6px;
    font-size: 14px;
    background: var(--md-default-bg-color);
    color: var(--md-default-fg-color);
    box-sizing: border-box;
    font-family: inherit;
}

.form-group input:focus, 
.form-group select:focus {
    outline: none;
    border-color: var(--md-accent-fg-color);
    box-shadow: 0 0 0 2px var(--md-accent-fg-color--transparent);
}

.hint {
    font-size: 12px;
    color: var(--md-default-fg-color--light);
    margin-top: 5px;
}

.status-indicator {
    display: flex;
    align-items: center;
    margin: 20px 0;
    padding: 16px;
    border-radius: 6px;
    font-weight: 500;
    border: 1px solid;
}

.status-ready {
    background: rgba(46, 160, 67, 0.1);
    color: var(--md-typeset-color);
    border-color: rgba(46, 160, 67, 0.2);
}

.status-offline {
    background: rgba(255, 152, 0, 0.1);
    color: var(--md-typeset-color);
    border-color: rgba(255, 152, 0, 0.2);
}

.status-error {
    background: rgba(231, 76, 60, 0.1);
    color: var(--md-typeset-color);
    border-color: rgba(231, 76, 60, 0.2);
}

.status-processing {
    background: rgba(52, 152, 219, 0.1);
    color: var(--md-typeset-color);
    border-color: rgba(52, 152, 219, 0.2);
}

.status-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    margin-right: 12px;
    flex-shrink: 0;
}

.dot-green { background: #2ea043; }
.dot-orange { background: #ff9800; }
.dot-red { background: #e74c3c; }
.dot-blue { background: #3498db; }

.generate-btn {
    background: var(--md-primary-fg-color);
    color: var(--md-primary-bg-color);
    padding: 12px 30px;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    cursor: pointer;
    width: 100%;
    margin: 20px 0;
    font-weight: 500;
    transition: all 0.2s ease;
}

.generate-btn:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
}

.generate-btn:disabled {
    background: var(--md-default-fg-color--lighter);
    color: var(--md-default-fg-color--lightest);
    cursor: not-allowed;
    transform: none;
}

.progress-container {
    margin: 20px 0;
    display: none;
}

.progress-bar {
    width: 100%;
    height: 8px;
    background: var(--md-default-fg-color--lightest);
    border-radius: 4px;
    overflow: hidden;
}

.progress-fill {
    height: 100%;
    background: var(--md-accent-fg-color);
    width: 0%;
    transition: width 0.3s ease;
}

.progress-text {
    text-align: center;
    margin-top: 10px;
    color: var(--md-default-fg-color--light);
    font-size: 14px;
}

.result-container {
    margin-top: 30px;
    display: none;
}

.result-text {
    width: 100%;
    height: 400px;
    padding: 16px;
    border: 2px solid var(--md-default-fg-color--lighter);
    border-radius: 6px;
    font-family: 'SFMono-Regular', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
    box-sizing: border-box;
    background: var(--md-code-bg-color);
    color: var(--md-code-fg-color);
}

.download-btn {
    background: var(--md-accent-fg-color);
    color: var(--md-accent-bg-color);
    margin-top: 15px;
}

.download-btn:hover:not(:disabled) {
    opacity: 0.9;
}

.offline-notice {
    background: var(--md-default-fg-color--lightest);
    padding: 20px;
    border-radius: 6px;
    margin: 20px 0;
    text-align: center;
}

.offline-notice h3 {
    margin-top: 0;
    color: var(--md-default-fg-color);
}

.config-section {
    background: var(--md-code-bg-color);
    padding: 20px;
    border-radius: 6px;
    margin: 30px 0;
    border-left: 4px solid var(--md-accent-fg-color);
}

.config-section h3 {
    margin-top: 0;
    color: var(--md-default-fg-color);
}
</style>

<div class="scriptotic-container">
    <h1>Scriptotic Transcript Generator</h1>
    
    <p>Convert YouTube videos to accurate text transcripts using the Voxtral Mini 3B AI model. Perfect for when your friends send videos but you prefer reading.</p>
    
    <div id="server-status" class="status-indicator status-offline">
        <div class="status-dot dot-orange"></div>
        <span id="status-text">Connecting to transcription service...</span>
    </div>
    
    <form id="transcription-form">
        <div class="form-group">
            <label for="url">YouTube URL</label>
            <input type="url" id="url" name="url" value="https://www.youtube.com/watch?v=MFDiuBomSuY" required>
        </div>
        
        <div class="form-group">
            <label for="speakers">Speaker Names (Optional)</label>
            <input type="text" id="speakers" name="speakers" value="Linus, Luke" placeholder="Alice, Bob, Charlie">
            <div class="hint">Comma-separated names for speaker identification</div>
        </div>
        
        <div class="form-group">
            <label for="engine">AI Model</label>
            <div class="config-section" style="margin: 0; border-left: none; padding: 15px; background: var(--md-default-fg-color--lightest);">
                <strong style="color: var(--md-accent-fg-color);">Voxtral Mini 3B</strong>
                <br><small>Advanced speech recognition with automatic language detection</small>
            </div>
        </div>
        
        <div class="form-group">
            <label for="format">Output Format</label>
            <select id="format" name="format">
                <option value="text">Plain Text</option>
                <option value="json">JSON (with metadata)</option>
                <option value="srt">SRT Subtitles</option>
            </select>
        </div>
        
        <button type="submit" id="generate-btn" class="generate-btn" disabled>
            Generate Transcript
        </button>
    </form>
    
    <div id="progress-container" class="progress-container">
        <div class="progress-bar">
            <div id="progress-fill" class="progress-fill"></div>
        </div>
        <div id="progress-text" class="progress-text">Ready</div>
    </div>
    
    <div id="result-container" class="result-container">
        <h3>Transcript Result</h3>
        <textarea id="result-text" class="result-text" readonly placeholder="Your transcript will appear here..."></textarea>
        <button id="download-btn" class="generate-btn download-btn" style="display: none;">
            Download Transcript
        </button>
    </div>
    
    <div id="offline-notice" class="offline-notice" style="display: none;">
        <h3>🌐 Service Currently Offline</h3>
        <p>The transcription backend is not currently available. This happens when Brinedew's hardware is offline (traveling, maintenance, etc.).</p>
        <p><strong>Try again later</strong> or contact <a href="mailto:hello@brinedew.com">hello@brinedew.com</a> if you need urgent transcription.</p>
    </div>
    
    <div class="config-section">
        <h3>🔧 For Developers: Running Your Own Instance</h3>
        <p>Want to run Scriptotic yourself? The transcription backend runs on:</p>
        <ul>
            <li><strong>Hardware:</strong> RTX 4080 (12GB VRAM) or similar GPU</li>
            <li><strong>Model:</strong> Voxtral Mini 3B via vLLM</li>
            <li><strong>Setup:</strong> Windows + WSL2 + Python Flask API</li>
        </ul>
        <p>Source code and setup instructions: <a href="https://github.com/brinedew/scriptotic" target="_blank">GitHub Repository</a></p>
    </div>
</div>

<script>
(function() {
    // Configuration - update this when you're home with your PC  
    const API_BASE_URL = 'https://api2.brinedew.com';
    
    let currentJobId = null;
    let statusCheckInterval = null;
    let jobCheckInterval = null;
    
    // DOM elements
    const serverStatus = document.getElementById('server-status');
    const statusText = document.getElementById('status-text');
    const generateBtn = document.getElementById('generate-btn');
    const statusDot = serverStatus.querySelector('.status-dot');
    const offlineNotice = document.getElementById('offline-notice');
    
    function updateServerStatus(status, message, isOnline = false) {
        statusText.textContent = message;
        
        // Clear existing classes
        serverStatus.className = 'status-indicator';
        statusDot.className = 'status-dot';
        
        if (isOnline && status === 'ready') {
            serverStatus.classList.add('status-ready');
            statusDot.classList.add('dot-green');
            generateBtn.disabled = false;
            offlineNotice.style.display = 'none';
        } else if (isOnline && status === 'starting') {
            serverStatus.classList.add('status-processing');
            statusDot.classList.add('dot-blue');
            generateBtn.disabled = true;
            offlineNotice.style.display = 'none';
        } else if (isOnline) {
            serverStatus.classList.add('status-error');
            statusDot.classList.add('dot-red');
            generateBtn.disabled = true;
            offlineNotice.style.display = 'none';
        } else if (isOnline && status === 'offline') {
            // Server offline but will auto-start - allow transcription
            serverStatus.classList.add('status-offline');
            statusDot.classList.add('dot-orange');
            generateBtn.disabled = false;  // Enable button for on-demand startup
            offlineNotice.style.display = 'none';
        } else {
            // API not reachable
            serverStatus.classList.add('status-offline');
            statusDot.classList.add('dot-orange');
            generateBtn.disabled = true;
            offlineNotice.style.display = 'block';
        }
    }
    
    function checkServerStatus() {
        fetch(`${API_BASE_URL}/api/server-status`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then(data => {
            updateServerStatus(data.status, data.message, true);
        })
        .catch(error => {
            console.log('API unavailable:', error.message);
            updateServerStatus('offline', 'Transcription service offline', false);
        });
    }
    
    function checkJobStatus(jobId) {
        fetch(`${API_BASE_URL}/api/job-status/${jobId}`)
        .then(response => response.json())
        .then(data => {
            const progressContainer = document.getElementById('progress-container');
            const progressFill = document.getElementById('progress-fill');
            const progressText = document.getElementById('progress-text');
            const resultContainer = document.getElementById('result-container');
            const resultText = document.getElementById('result-text');
            const downloadBtn = document.getElementById('download-btn');
            
            // Update progress
            progressFill.style.width = data.progress + '%';
            progressText.textContent = data.message || 'Processing...';
            
            if (data.status === 'completed' && data.result) {
                // Show result
                resultText.value = data.result.output;
                resultContainer.style.display = 'block';
                downloadBtn.style.display = 'block';
                downloadBtn.onclick = () => downloadResult(jobId);
                
                // Reset form
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Transcript';
                
                // Stop checking
                if (jobCheckInterval) {
                    clearInterval(jobCheckInterval);
                    jobCheckInterval = null;
                }
                
            } else if (data.status === 'error') {
                // Show error
                resultText.value = `ERROR: ${data.error || 'Unknown error occurred'}\n\nTroubleshooting:\n1. Check that the YouTube URL is valid and accessible\n2. Try a shorter video (under 30 minutes)\n3. Wait a few minutes and try again\n4. Contact hello@brinedew.com if the problem persists`;
                resultContainer.style.display = 'block';
                downloadBtn.style.display = 'none';
                
                // Reset form
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Transcript';
                
                // Stop checking
                if (jobCheckInterval) {
                    clearInterval(jobCheckInterval);
                    jobCheckInterval = null;
                }
            }
            // If status is 'processing' or other, keep checking
        })
        .catch(error => {
            console.error('Error checking job status:', error);
            document.getElementById('progress-text').textContent = 'Lost connection to transcription service';
        });
    }
    
    function downloadResult(jobId) {
        // Generate timestamp filename like Tkinter GUI does
        const now = new Date();
        const timestamp = now.getFullYear() + 
            String(now.getMonth() + 1).padStart(2, '0') + 
            String(now.getDate()).padStart(2, '0') + '_' +
            String(now.getHours()).padStart(2, '0') + 
            String(now.getMinutes()).padStart(2, '0') + 
            String(now.getSeconds()).padStart(2, '0');
        
        const link = document.createElement('a');
        link.href = `${API_BASE_URL}/api/download/${jobId}`;
        link.download = `transcript_${timestamp}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    // Handle form submission
    document.getElementById('transcription-form').addEventListener('submit', function(e) {
        e.preventDefault();
        
        const formData = new FormData(this);
        const data = {
            url: formData.get('url'),
            speakers: formData.get('speakers'),
            format: formData.get('format')
        };
        
        const progressContainer = document.getElementById('progress-container');
        const resultContainer = document.getElementById('result-container');
        
        // Show progress, hide results
        generateBtn.disabled = true;
        generateBtn.textContent = 'Starting...';
        progressContainer.style.display = 'block';
        resultContainer.style.display = 'none';
        
        // Start transcription
        fetch(`${API_BASE_URL}/api/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }
            
            currentJobId = data.job_id;
            
            // Start checking job status every 3 seconds
            jobCheckInterval = setInterval(() => {
                checkJobStatus(currentJobId);
            }, 3000);
            
            // Check immediately
            checkJobStatus(currentJobId);
        })
        .catch(error => {
            console.error('Error starting transcription:', error);
            document.getElementById('progress-text').textContent = `Error: ${error.message}`;
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Transcript';
            
            // Show service offline notice if it's a connection error
            if (error.message.includes('Server error') || error.message.includes('Failed to fetch')) {
                updateServerStatus('offline', 'Transcription service offline', false);
            }
        });
    });
    
    // Start server status checking
    checkServerStatus();
    statusCheckInterval = setInterval(checkServerStatus, 10000); // Check every 10 seconds
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', function() {
        if (statusCheckInterval) clearInterval(statusCheckInterval);
        if (jobCheckInterval) clearInterval(jobCheckInterval);
    });
})();
</script>