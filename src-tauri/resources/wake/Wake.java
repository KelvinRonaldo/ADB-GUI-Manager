import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

/**
 * Injeta uma tecla (padrão 224, KEYCODE_WAKEUP) pelo InputManager, rodando no aparelho com
 *   CLASSPATH=/data/local/tmp/adbgui-wake.dex app_process / Wake [keycode]
 * Serve para aparelhos em que o comando `input keyevent` foi tirado (Gertec GPOS760).
 * Só reflexão: compila com o javac comum, sem android.jar.
 */
public class Wake {
    public static void main(String[] args) throws Exception {
        int code = args.length > 0 ? Integer.parseInt(args[0]) : 224;
        long now = (Long) Class.forName("android.os.SystemClock").getMethod("uptimeMillis").invoke(null);
        Class<?> keyEvent = Class.forName("android.view.KeyEvent");
        Constructor<?> ctor = keyEvent.getConstructor(long.class, long.class, int.class, int.class, int.class);
        Object down = ctor.newInstance(now, now, 0, code, 0);
        Object up = ctor.newInstance(now, now, 1, code, 0);
        Class<?> inputEvent = Class.forName("android.view.InputEvent");
        Object manager;
        Class<?> cls;
        try {
            // Android 14+
            cls = Class.forName("android.hardware.input.InputManagerGlobal");
            manager = cls.getMethod("getInstance").invoke(null);
        } catch (ClassNotFoundException e) {
            cls = Class.forName("android.hardware.input.InputManager");
            manager = cls.getMethod("getInstance").invoke(null);
        }
        Method inject = cls.getMethod("injectInputEvent", inputEvent, int.class);
        // 2 = INJECT_INPUT_EVENT_MODE_WAIT_FOR_FINISH
        inject.invoke(manager, down, 2);
        inject.invoke(manager, up, 2);
        System.out.println("ok " + code);
    }
}
