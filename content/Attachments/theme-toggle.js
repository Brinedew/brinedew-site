// Custom theme toggle functionality
document.addEventListener('DOMContentLoaded', function() {
    // Create and insert theme toggle element
    const tabs = document.querySelector('.md-tabs');
    if (tabs) {
        const themeToggle = document.createElement('span');
        themeToggle.className = 'md-tabs__theme-toggle';
        themeToggle.textContent = getCurrentScheme() === 'slate' ? 'light' : 'dark';
        
        tabs.appendChild(themeToggle);
        
        // Add click event to the theme toggle
        themeToggle.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleTheme();
        });
    }
    
    function getCurrentScheme() {
        return document.documentElement.getAttribute('data-md-color-scheme') || 'default';
    }
    
    function updateToggleText() {
        const toggle = document.querySelector('.md-tabs__theme-toggle');
        if (toggle) {
            toggle.textContent = getCurrentScheme() === 'slate' ? 'light' : 'dark';
        }
    }
    
    function toggleTheme() {
        const html = document.documentElement;
        const currentScheme = getCurrentScheme();
        
        // Find all palette inputs (light and dark)
        const darkPalette = document.querySelector('input[data-md-color-scheme="slate"]');
        const lightPalette = document.querySelector('input[data-md-color-scheme="default"]');
        
        if (currentScheme === 'slate') {
            // Switch to light mode
            html.setAttribute('data-md-color-scheme', 'default');
            localStorage.setItem('data-md-color-scheme', 'default');
            
            if (darkPalette) darkPalette.checked = false;
            if (lightPalette) lightPalette.checked = true;
        } else {
            // Switch to dark mode
            html.setAttribute('data-md-color-scheme', 'slate');
            localStorage.setItem('data-md-color-scheme', 'slate');
            
            if (lightPalette) lightPalette.checked = false;
            if (darkPalette) darkPalette.checked = true;
        }
        
        // Trigger change events on both inputs
        const changeEvent = new Event('change', { bubbles: true });
        if (darkPalette) darkPalette.dispatchEvent(changeEvent);
        if (lightPalette) lightPalette.dispatchEvent(changeEvent);
        
        updateToggleText();
    }
    
    // Load saved theme preference
    const savedScheme = localStorage.getItem('data-md-color-scheme');
    if (savedScheme) {
        document.documentElement.setAttribute('data-md-color-scheme', savedScheme);
    }
    
    // Update toggle text after theme loads
    setTimeout(updateToggleText, 100);
});