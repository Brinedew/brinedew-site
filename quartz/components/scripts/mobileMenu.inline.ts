document.addEventListener("nav", () => {
  const tagExplorer = document.querySelector<HTMLElement>(".tag-explorer")
  const tagExplorerContent = document.querySelector<HTMLElement>(".tag-explorer-content")
  if (!tagExplorer || !tagExplorerContent) return

  const buttons = document.querySelectorAll<HTMLButtonElement>(".mobile-menu-toggle")

  for (const button of buttons) {
    // Fix ARIA-controls dynamically
    if (tagExplorerContent.id) {
      button.setAttribute('aria-controls', tagExplorerContent.id)
    }

    // One stable handler per button per nav (fixes the multiple listener bug)
    const onClick = (ev: Event) => {
      ev.preventDefault()
      ev.stopPropagation()
      const isOpen = tagExplorer.classList.toggle("mobile-open")
      button.setAttribute("aria-expanded", String(isOpen))

      // Prevent background scrolling when menu is open
      document.body.style.overflow = isOpen ? "hidden" : ""
      
      if (isOpen) {
        tagExplorerContent.removeAttribute("inert")
        // Focus management - move focus to first link in menu
        const firstLink = tagExplorerContent.querySelector('a') as HTMLAnchorElement
        if (firstLink) {
          firstLink.focus()
        }
      } else {
        tagExplorerContent.setAttribute("inert", "")
        // Return focus to menu button
        button.focus()
      }
    }

    button.addEventListener("click", onClick)
    window.addCleanup(() => button.removeEventListener("click", onClick))
  }

  // Global keyboard handler
  const onEscapeKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && tagExplorer.classList.contains('mobile-open')) {
      tagExplorer.classList.remove('mobile-open')
      document.body.style.overflow = ''
      const button = document.querySelector<HTMLButtonElement>('.mobile-menu-toggle')
      if (button) {
        button.setAttribute('aria-expanded', 'false')
        button.focus()
      }
    }
  }

  // Global click-outside handler
  const onOutsideClick = (event: Event) => {
    const target = event.target as HTMLElement
    if (!tagExplorer.classList.contains('mobile-open')) return
    
    // Don't close if clicking inside the menu or on any menu button
    if (tagExplorer.contains(target) || target.closest('.mobile-menu-toggle')) return
    
    tagExplorer.classList.remove('mobile-open')
    document.body.style.overflow = ''
    const button = document.querySelector<HTMLButtonElement>('.mobile-menu-toggle')
    if (button) {
      button.setAttribute('aria-expanded', 'false')
    }
  }

  document.addEventListener('keydown', onEscapeKey)
  document.addEventListener('click', onOutsideClick)
  
  window.addCleanup(() => {
    document.removeEventListener('keydown', onEscapeKey)
    document.removeEventListener('click', onOutsideClick)
  })
})