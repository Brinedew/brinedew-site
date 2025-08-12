const script = `
if (document.startViewTransition) {
  // Intercept all same-origin navigation
  document.addEventListener('click', e => {
    const link = e.target.closest('a');
    if (!link || link.origin !== location.origin) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    
    e.preventDefault();
    
    document.startViewTransition(async () => {
      // Fetch and replace content
      const response = await fetch(link.href);
      const html = await response.text();
      const parser = new DOMParser();
      const newDoc = parser.parseFromString(html, 'text/html');
      
      // Swap content but keep scroll for back button
      document.documentElement.replaceWith(newDoc.documentElement);
      history.pushState({}, '', link.href);
    });
  });
}
`;

export default script;