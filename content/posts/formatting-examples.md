---
title: Formatting Examples
date: 2025-09-20
noindex: true
draft: false
tags:
  - meta
---

# Formatting Examples

This page contains all potentially problematic elements for dark mode testing.

## Tables


| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Data A   | Data B   | Data C   |




## Code Blocks

```python
def test_function():
    # This is a comment
    number = 42
    string = "hello world"
    return f"Result: {number}"
```


```bash
# Shell commands
cd /some/directory
ls -la
grep "pattern" file.txt
```




## Inline Code


Here is some `inline code` in a sentence.


## Keyboard Keys


Press <kbd>Ctrl+Alt+Delete</kbd> to restart.


Use <kbd>Cmd+C</kbd> to copy and <kbd>Cmd+V</kbd> to paste.


## Marked/Highlighted Text
This is ==highlighted text== that should be visible.

## Search Elements

*Note: Search functionality will be tested by actually searching*

## Form Inputs



*Note: If any forms exist, they would appear here*

## Admonitions/Callouts


> [!note] Note Callout
> This is a note callout with some content.




> [!warning] Warning Callout
> This is a warning with important information.




> [!tip] Tip Callout
> This is a helpful tip for users.




> [!danger] Danger Callout
> This indicates something dangerous or critical.




## Blockquotes




> This is a blockquote with some text.
> It can span multiple lines and should be readable.
> 
> -- Famous Person




## Task Lists/Checkboxes


- [x] Completed task
- [ ] Incomplete task
- [x] Another completed item
- [ ] Another incomplete item


## Details/Summary Elements


> [!info]- Collapsible Section
> This content is hidden by default and can be expanded.
> 
> - Item 1
> - Item 2
> - Item 3


> [!note]- Collapsible Note
> This is a collapsible note with additional information.
> ```python
> def test_function():
> 	# This is a comment
> 	number = 42
> 	string = "hello world"
> 	return f"Result: {number}"
> ```


## Footnotes

This text has a footnote reference[^1].

Here's another footnote[^2].


[^1]: This is the first footnote.
[^2]: This is the second footnote with more content.

## Math Expressions (if MathJax is enabled)

Inline math: $E = mc^2$

Block math:

$$\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}$$


## Links

[Regular link to home page](../index.md)

[External link](https://example.com)


## Lists

### Ordered Lists

1. First item
2. Second item
   3. Nested item
   4. Another nested item
5. Third item
### Unordered Lists

- First bullet
- Second bullet
  - Nested bullet
  - Another nested bullet
- Third bullet




## Images and Transclusions


![Anoikis illustration](../Attachments/anoikis-illustration.png)


### Transclusion Test


![[cellular-senescence#^what-it-is]]


*The above should show a transclusion of the cellular senescence definition*


## Navigation Elements


*Note: Navigation, breadcrumbs, and mobile drawer will be tested by navigation*


## Tooltips/Annotations


*Note: Any tooltip functionality would be tested here*


## Social Media Embeds


*Note: If any social media embeds exist, they would be tested here*


## Complex Typography


**Bold text** and *italic text* and ***bold italic text***.


~~Strikethrough text~~


`code` mixed with **bold** and *italic*.


---


This test page should reveal any dark mode color issues across all major content types and interactive elements.
