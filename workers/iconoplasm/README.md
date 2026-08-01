# Iconoplasm module extraction target

The protected Worker entrypoints remain the composition boundary. New modules
belong under this directory only when they have a narrow responsibility and a
focused contract test. The directory deliberately contains no alternate
Worker entrypoint: that absence is part of the anti-ping-pong guard.
