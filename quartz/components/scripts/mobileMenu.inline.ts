function toggleMobileMenu() {
  const menuButton = document.querySelector('.mobile-menu-toggle') as HTMLButtonElement
  const tagExplorer = document.querySelector('.tag-explorer') as HTMLElement
  const tagExplorerContent = document.querySelector('.tag-explorer-content') as HTMLElement
  
  if (!menuButton || !tagExplorer || !tagExplorerContent) return
  
  const isOpen = tagExplorer.classList.toggle('mobile-open')
  
  // Update ARIA attributes
  menuButton.setAttribute('aria-expanded', String(isOpen))
  
  // Prevent background scrolling when menu is open
  if (isOpen) {
    document.body.style.overflow = 'hidden'
    tagExplorerContent.setAttribute('inert', 'false')
    // Focus management - move focus to first link in menu
    const firstLink = tagExplorerContent.querySelector('a') as HTMLAnchorElement
    if (firstLink) {
      firstLink.focus()
    }
  } else {
    document.body.style.overflow = ''
    tagExplorerContent.setAttribute('inert', 'true')
    // Return focus to menu button
    menuButton.focus()
  }
}

function closeMobileMenuOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    const tagExplorer = document.querySelector('.tag-explorer') as HTMLElement
    if (tagExplorer?.classList.contains('mobile-open')) {
      toggleMobileMenu()
    }
  }
}

function closeMobileMenuOnOutsideClick(event: Event) {
  const target = event.target as HTMLElement
  const tagExplorer = document.querySelector('.tag-explorer') as HTMLElement
  const menuButton = document.querySelector('.mobile-menu-toggle') as HTMLElement
  
  if (!tagExplorer?.classList.contains('mobile-open')) return
  
  // Don't close if clicking inside the menu or on the menu button
  if (tagExplorer.contains(target) || menuButton.contains(target)) return
  
  toggleMobileMenu()
}

document.addEventListener('DOMContentLoaded', () => {
  const menuButton = document.querySelector('.mobile-menu-toggle')
  
  if (menuButton) {
    menuButton.addEventListener('click', toggleMobileMenu)
    
    // Add keyboard and click-outside handlers
    document.addEventListener('keydown', closeMobileMenuOnEscape)
    document.addEventListener('click', closeMobileMenuOnOutsideClick)
    
    // Cleanup on navigation
    window.addCleanup(() => {
      menuButton.removeEventListener('click', toggleMobileMenu)
      document.removeEventListener('keydown', closeMobileMenuOnEscape) 
      document.removeEventListener('click', closeMobileMenuOnOutsideClick)
    })
  }
})

// Handle navigation events (SPA routing)
document.addEventListener('nav', () => {
  // Close mobile menu on navigation
  const tagExplorer = document.querySelector('.tag-explorer') as HTMLElement
  if (tagExplorer?.classList.contains('mobile-open')) {
    tagExplorer.classList.remove('mobile-open')
    document.body.style.overflow = ''
    
    const menuButton = document.querySelector('.mobile-menu-toggle') as HTMLButtonElement
    if (menuButton) {
      menuButton.setAttribute('aria-expanded', 'false')
    }
  }
})