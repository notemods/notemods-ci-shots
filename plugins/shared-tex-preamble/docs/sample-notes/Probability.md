For a random variable $X$ with density $f$ on $\R$:

$$\E[X] = \int_{\R} x \, f(x) \dd x$$

$$\Var(X) = \E\left[(X - \E[X])^2\right] = \E[X^2] - \E[X]^2$$

For $n \in \N$ independent copies with mean $\bar X_n$:

$$\Var(\bar X_n) = \frac{\Var(X)}{n}$$

Chebyshev: $P(\abs{X - \E[X]} \ge k) \le \Var(X) / k^2$.
