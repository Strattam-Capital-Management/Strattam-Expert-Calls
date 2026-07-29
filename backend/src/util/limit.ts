// Small hand-rolled concurrency limiter (avoids pulling in p-limit, whose recent major
// versions are ESM-only and awkward to consume from a CommonJS build). Usage:
//
//   const limit = createLimiter(3);
//   await Promise.all(items.map((item) => limit(() => doWork(item))));

export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function runNext(): void {
    active--;
    const next = queue.shift();
    if (next) next();
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active++;
        fn().then(
          (val) => {
            resolve(val);
            runNext();
          },
          (err) => {
            reject(err);
            runNext();
          }
        );
      };

      if (active < concurrency) {
        start();
      } else {
        queue.push(start);
      }
    });
  };
}
