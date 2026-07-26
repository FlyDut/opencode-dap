public class App {
    public static void main(String[] args) {
        int a = 10;
        int b = 20;
        int sum = add(a, b);
        System.out.println("sum = " + sum);

        String msg = greet("opencode");
        System.out.println(msg);

        int fib = fibonacci(10);
        System.out.println("fib(10) = " + fib);
    }

    static int add(int x, int y) {
        return x + y;
    }

    static String greet(String name) {
        return "Hello, " + name + "!";
    }

    static int fibonacci(int n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
    }
}
