document.addEventListener("nav", () => {
  const tagSections = document.querySelector<HTMLElement>(".tag-sections")
  if (!tagSections) return

  const buttons = document.querySelectorAll<HTMLButtonElement>(".mobile-menu-toggle")

  for (const button of buttons) {
    const onClick = (ev: Event) => {
      ev.preventDefault()
      ev.stopPropagation()
      const isOpen = tagSections.classList.toggle("mobile-open")
      button.setAttribute("aria-expanded", String(isOpen))
    }

    button.addEventListener("click", onClick)
    window.addCleanup(() => button.removeEventListener("click", onClick))
  }

  // Close on Escape
  const onEscapeKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && tagSections.classList.contains('mobile-open')) {
      tagSections.classList.remove('mobile-open')
      const button = document.querySelector<HTMLButtonElement>('.mobile-menu-toggle')
      if (button) {
        button.setAttribute('aria-expanded', 'false')
        button.focus()
      }
    }
  }

  // Close on click outside
  const onOutsideClick = (event: Event) => {
    const target = event.target as HTMLElement
    if (!tagSections.classList.contains('mobile-open')) return
    if (tagSections.contains(target) || target.closest('.mobile-menu-toggle')) return
    
    tagSections.classList.remove('mobile-open')
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