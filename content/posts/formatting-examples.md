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

*Editor note: this page intentionally uses explicit math delimiters here because the site parser disables single-dollar inline math on purpose, so ordinary prose like currency does not break when content is published from Obsidian.*

Inline math: $$E = mc^2$$

Block math:

$$\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}$$


## Links

[Regular link to home page](../index.md)

[External link](https://example.com)


## Lists

### Ordered Lists

1. First item
2. Second item
	1. Nested item
	2. Another nested item
3. Third item

### List Structure Stress Test

*Editor note: do not "clean up" the indentation in this section unless you re-check the built HTML. These examples are intentionally spaced to match strict CommonMark list nesting in Quartz, because smaller indents can look acceptable in Obsidian while silently breaking on the published site.*

1. **Top-level item with multiple paragraphs**

    This paragraph should stay attached to the list item and align under the item text, not break out into the main article flow.

    This is a second paragraph in the same item. It is intentionally separated by a blank line so we can test loose-list rendering.

1. **Top-level item with nested bullets and extra paragraphs**

    Intro paragraph for the second item.

    - First nested bullet
    - Second nested bullet with its own continuation paragraph.

        This paragraph should remain attached to the nested bullet rather than snapping back to the outer list.

    Back on the parent item again. This paragraph should still belong to the same numbered item.

1. **Top-level item with deeper nesting**

    1. Nested ordered item

        This paragraph belongs to the nested ordered item.

    2. Another nested ordered item

        - Deep nested bullet
        - Another deep nested bullet

            Continuation paragraph for the deep nested bullet.

    Final paragraph for the outer numbered item after the nested ordered list ends.

1. **Top-level item with a blockquote**

    > This blockquote should stay inside the list item.
    >
    > So should this second quoted paragraph.

    Final paragraph after the blockquote.

### Unordered Lists

- First bullet
	- Test
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
