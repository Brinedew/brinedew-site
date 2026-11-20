---
title: Four-parameter logistic model
tags:
  - content/wiki
date: 2026-11-17
draft: true
vital_level: 5
class: Stub
aliases:
  -
---
# Four-parameter logistic

**Four-Parameter Logistic (4PL)** regression model, widely used to generate sigmoidal ("S"-shaped) curves in bioassays, immunoassays (such as ELISA), and dose-response analyses. 

***
y = D + (A - D)/(1 + (x/C)^B)
Parameter Breakdown

- **
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    yy
    
    𝒚
    
    ⁠**: The measured response or dependent variable (e.g., optical density, signal intensity).

- **
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    xx
    
    𝒙
    
    ⁠**: The independent variable or concentration/dose.

- **
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    Acap A
    
    𝑨
    
    ⁠**: The minimum asymptote (the response value at zero concentration or the bottom plateau of the curve).

- **
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    Dcap D
    
    𝑫
    
    ⁠**: The maximum asymptote (the response value at an infinite concentration or the top plateau of the curve). _(Note: In some software packages, the positions of
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    Acap A
    
    𝐴
    
    ⁠ and
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    Dcap D
    
    𝐷
    
    ⁠ are swapped)._

- **
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    Ccap C
    
    𝑪
    
    ⁠**: The inflection point (the
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    xx
    
    𝑥
    
    ⁠-value halfway between the minimum and maximum responses, often corresponding to the
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    EC50EC sub 50
    
    EC50
    
    ⁠ or
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    IC50IC sub 50
    
    IC50
    
    ⁠).

- **
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    Bcap B
    
    𝑩
    
    ⁠**: The Hill slope (determines the steepness or slope of the curve around the inflection point
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    Ccap C
    
    𝐶
    
    ⁠; can be positive or negative). [](https://www.medcalc.org/en/manual/nonlinearregression-example.php)
    
    ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAtFBMVEX///+ZzP8AZsxwcHDPz88AZcsANJr3+//0+v+12v+z2f/A5//9/v/4/P+Zv+3u+P/k9P/b29uTv+vn8/91rufe7//Y6/9cn+LuKwDS6P/jJQDZ8P/XHwDL5f/MGQBDkN3P7f/BFAC1DgDC4f+qCAAAmQAug9gAXsTz8/OUlJSqzO8AV70AcckAULYAZ8JXxCsAXbpCuiEAU7IAR60usBcARKoVpAsfetW3t7eIiIhMTExkZGTeQrWnAAABNUlEQVQ4jY3TbXPBQBSG4XTJlqYl6WtqlVAkCEISqv3//6vnPOxGZxa9v5wzmWsyWbMc52rupYKEwA0StuFOgyugVnec+AKIAcT5DuAWzWzjABpoZhsA8zYyr6XDxdycW3wReETC+iMt9gSeUAXSNK1A7R9gcQT3uuVyaXaAZyQedATMDvCCBM61Wq0aWZY1dKcAh12v120CbR2D/BUJnyPgbzYbX5czeEPCD8PQL4oCgHcD3pHrdzodgDzPsWtQHoHqdruKgCJQ7Qw+kKt6vZ7abreqLEuzA/SRGw0Gg4geRlJKs5cMPlEcDYfDaDweA+j9FHij0cijhx4Bs/8BthjICTJXBOUcfS1AE02azRaVtlonQ37vDdjZhvyhKyfv0M42JF9aeSkGwbR2Pv5vJkH9fEHyC6CDQpEj4c12AAAAAElFTkSuQmCC)MedCalc Statistical Software +4

Key Characteristics

- **Symmetrical Sigmoid:** The 4PL curve is symmetrical around its inflection point
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    Ccap C
    
    𝐶
    
    ⁠.

- **Curve Fitting:** To fit experimental or standard curve data (such as via [GraphPad Prism](https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_asymmetric_dose_response_ec.htm) or specialized bioassay calculators like Ario), researchers use non-linear least-squares regression to estimate the values of
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)𝐴
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==),
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)𝐵
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==),
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)𝐶
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==),
    
    ⁠ and
    
    ![](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)
    
    Dcap D
    
    𝐷
    
    ⁠.
