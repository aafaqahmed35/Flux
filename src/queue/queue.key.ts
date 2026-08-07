export class QueueKeyFactory {
  private static readonly PREFIX = 'flux';

  static queue(queueName: string): string {
    return `${this.PREFIX}:queue:${queueName}`;
  }

  static processing(queueName: string): string {
    return `${this.PREFIX}:processing:${queueName}`;
  }

  static scheduled(): string {
    return `${this.PREFIX}:scheduled`;
  }

  static deadLetter(): string {
    return `${this.PREFIX}:deadletter`;
  }

  static workers(): string {
    return `${this.PREFIX}:workers`;
  }

  static queuesSet(): string {
    return `${this.PREFIX}:queues`;
  }
}
