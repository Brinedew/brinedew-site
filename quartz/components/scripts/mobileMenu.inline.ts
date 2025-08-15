// Follow the working pattern from darkmode.inline.ts
document.addEventListener("nav", () => {
  const toggleMobileMenu = (menuButton: HTMLButtonElement) => {
    const tagExplorer = document.querySelector('.tag-explorer') as HTMLElement
    const tagExplorerContent = document.querySelector('.tag-explorer-content') as HTMLElement
    
    if (!tagExplorer || !tagExplorerContent) return
    
    const isOpen = tagExplorer.classList.toggle('mobile-open')
    
    // Update ARIA attributes
    menuButton.setAttribute('aria-expanded', String(isOpen))
    
    // Prevent background scrolling when menu is open
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      // Focus management - move focus to first link in menu
      const firstLink = tagExplorerContent.querySelector('a') as HTMLAnchorElement
      if (firstLink) {
        firstLink.focus()
      }
    } else {
      document.body.style.overflow = ''
      // Return focus to menu button
      menuButton.focus()
    }
  }

  const closeMobileMenuOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      const tagExplorer = document.querySelector('.tag-explorer') as HTMLElement
      const menuButton = document.querySelector('.mobile-menu-toggle') as HTMLButtonElement
      if (tagExplorer?.classList.contains('mobile-open') && menuButton) {
        toggleMobileMenu(menuButton)
      }
    }
  }

  const closeMobileMenuOnOutsideClick = (event: Event) => {
    const target = event.target as HTMLElement
    const tagExplorer = document.querySelector('.tag-explorer') as HTMLElement
    const menuButton = document.querySelector('.mobile-menu-toggle') as HTMLButtonElement
    
    if (!tagExplorer?.classList.contains('mobile-open') || !menuButton) return
    
    // Don't close if clicking inside the menu or on the menu button
    if (tagExplorer.contains(target) || menuButton.contains(target)) return
    
    toggleMobileMenu(menuButton)
  }

  // Attach click handlers to all mobile menu buttons (following darkmode pattern)
  for (const menuButton of document.getElementsByClassName("mobile-menu-toggle")) {
    const button = menuButton as HTMLButtonElement
    
    // Fix ARIA-controls dynamically
    const tagExplorerContent = document.querySelector('.tag-explorer-content') as HTMLElement
    if (tagExplorerContent && tagExplorerContent.id) {
      button.setAttribute('aria-controls', tagExplorerContent.id)
    }
    
    button.addEventListener("click", () => toggleMobileMenu(button))
    window.addCleanup(() => button.removeEventListener("click", () => toggleMobileMenu(button)))
  }

  // Add global keyboard and click-outside handlers
  document.addEventListener('keydown', closeMobileMenuOnEscape)
  document.addEventListener('click', closeMobileMenuOnOutsideClick)
  
  window.addCleanup(() => {
    document.removeEventListener('keydown', closeMobileMenuOnEscape)
    document.removeEventListener('click', closeMobileMenuOnOutsideClick)
  })
})