/** @prettier */
import { Operator } from '../Operator';
import { Subscriber } from '../Subscriber';
import { Observable } from '../Observable';
import { Subscription } from '../Subscription';
import { ObservableInput, OperatorFunction } from '../types';
import { lift } from '../util/lift';
import { SimpleOuterSubscriber, innerSubscribe, SimpleInnerSubscriber } from '../innerSubscribe';
import { OperatorSubscriber } from './OperatorSubscriber';
import { from } from '../observable/from';

/**
 * Buffers the source Observable values, using a factory function of closing
 * Observables to determine when to close, emit, and reset the buffer.
 *
 * <span class="informal">Collects values from the past as an array. When it
 * starts collecting values, it calls a function that returns an Observable that
 * tells when to close the buffer and restart collecting.</span>
 *
 * ![](bufferWhen.png)
 *
 * Opens a buffer immediately, then closes the buffer when the observable
 * returned by calling `closingSelector` function emits a value. When it closes
 * the buffer, it immediately opens a new buffer and repeats the process.
 *
 * ## Example
 *
 * Emit an array of the last clicks every [1-5] random seconds
 *
 * ```ts
 * import { fromEvent, interval } from 'rxjs';
 * import { bufferWhen } from 'rxjs/operators';
 *
 * const clicks = fromEvent(document, 'click');
 * const buffered = clicks.pipe(bufferWhen(() =>
 *   interval(1000 + Math.random() * 4000)
 * ));
 * buffered.subscribe(x => console.log(x));
 * ```
 *
 *
 * @see {@link buffer}
 * @see {@link bufferCount}
 * @see {@link bufferTime}
 * @see {@link bufferToggle}
 * @see {@link windowWhen}
 *
 * @param {function(): Observable} closingSelector A function that takes no
 * arguments and returns an Observable that signals buffer closure.
 * @return {Observable<T[]>} An observable of arrays of buffered values.
 * @name bufferWhen
 */
export function bufferWhen<T>(closingSelector: () => ObservableInput<any>): OperatorFunction<T, T[]> {
  return (source: Observable<T>) =>
    lift(source, function (this: Subscriber<T[]>, source: Observable<T>) {
      const subscriber = this;
      let buffer: T[] | null = null;
      let closingSubscriber: Subscriber<T> | null = null;
      let isComplete = false;

      const openBuffer = () => {
        closingSubscriber?.unsubscribe();

        const b = buffer;
        buffer = [];
        b && subscriber.next(b);

        let closingNotifier: Observable<any>;
        try {
          closingNotifier = from(closingSelector());
        } catch (err) {
          subscriber.error(err);
          return;
        }

        closingNotifier.subscribe(
          (closingSubscriber = new OperatorSubscriber(subscriber, openBuffer, undefined, () => {
            isComplete ? subscriber.complete() : openBuffer();
          }))
        );
      };

      openBuffer();

      source.subscribe(
        new OperatorSubscriber(
          subscriber,
          (value) => buffer?.push(value),
          undefined,
          () => {
            isComplete = true;
            buffer && subscriber.next(buffer);
            subscriber.complete();
          },
          () => {
            buffer = null!;
            closingSubscriber = null!;
          }
        )
      );
    });
}

class BufferWhenOperator<T> implements Operator<T, T[]> {
  constructor(private closingSelector: () => Observable<any>) {}

  call(subscriber: Subscriber<T[]>, source: any): any {
    return source.subscribe(new BufferWhenSubscriber(subscriber, this.closingSelector));
  }
}

class BufferWhenSubscriber<T> extends SimpleOuterSubscriber<T, any> {
  private buffer: T[] | undefined;
  private subscribing: boolean = false;
  private closingSubscription: Subscription | undefined;

  constructor(destination: Subscriber<T[]>, private closingSelector: () => Observable<any>) {
    super(destination);
    this.openBuffer();
  }

  protected _next(value: T) {
    this.buffer!.push(value);
  }

  protected _complete() {
    const buffer = this.buffer;
    if (buffer) {
      this.destination.next(buffer);
    }
    super._complete();
  }

  unsubscribe() {
    if (!this.closed) {
      this.buffer = null!;
      this.subscribing = false;
      super.unsubscribe();
    }
  }

  notifyNext(): void {
    this.openBuffer();
  }

  notifyComplete(): void {
    if (this.subscribing) {
      this.complete();
    } else {
      this.openBuffer();
    }
  }

  openBuffer() {
    let { closingSubscription } = this;

    if (closingSubscription) {
      this.remove(closingSubscription);
      closingSubscription.unsubscribe();
    }

    const buffer = this.buffer;
    if (this.buffer) {
      this.destination.next(buffer);
    }

    this.buffer = [];

    let closingNotifier;
    try {
      const { closingSelector } = this;
      closingNotifier = closingSelector();
    } catch (err) {
      return this.error(err);
    }
    closingSubscription = new Subscription();
    this.closingSubscription = closingSubscription;
    this.add(closingSubscription);
    this.subscribing = true;
    closingSubscription.add(innerSubscribe(closingNotifier, new SimpleInnerSubscriber(this)));
    this.subscribing = false;
  }
}
