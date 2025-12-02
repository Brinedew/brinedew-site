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
})