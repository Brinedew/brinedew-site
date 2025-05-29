// Custom theme toggle functionality
document.addEventListener('DOMContentLoaded', function() {
    // Add click event to the theme toggle
    const tabs = document.querySelector('.md-tabs');
    if (tabs) {
        tabs.addEventListener('click', function(e) {
            // Check if click is on the theme toggle area (right side)
            const rect = tabs.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            
            // If click is in the right 100px, treat as theme toggle
            if (clickX > rect.width - 100) {
                e.preventDefault();
                toggleTheme();
            }
        });
    }
    
    function toggleTheme() {
        const html = document.documentElement;
        const currentScheme = html.getAttribute('data-md-color-scheme');
        
        if (currentScheme === 'slate') {
            html.setAttribute('data-md-color-scheme', 'default');
            localStorage.setItem('data-md-color-scheme', 'default');
        } else {
            html.setAttribute('data-md-color-scheme', 'slate');
            localStorage.setItem('data-md-color-scheme', 'slate');
        }
    }
    
    // Load saved theme preference
    const savedScheme = localStorage.getItem('data-md-color-scheme');
    if (savedScheme) {
        document.documentElement.setAttribute('data-md-color-scheme', savedScheme);
    }
});