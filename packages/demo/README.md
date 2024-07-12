This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `pages/index.tsx`. The page auto-updates as you edit the file.

[API routes](https://nextjs.org/docs/api-routes/introduction) can be accessed on [http://localhost:3000/api/hello](http://localhost:3000/api/hello). This endpoint can be edited in `pages/api/hello.ts`.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/api-routes/introduction) instead of React pages.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.


## FRIDA script for bypassing Android FLAG_SECURE

```js
Java.perform(function() {
    var surface_view = Java.use('android.view.SurfaceView');

    var set_secure = surface_view.setSecure.overload('boolean');

    set_secure.implementation = function(flag){
        console.log("setSecure() flag called with args: " + flag); 
        set_secure.call(false);
    };

    var window = Java.use('android.view.Window');
    var set_flags = window.setFlags.overload('int', 'int');

    var window_manager = Java.use('android.view.WindowManager');
    var layout_params = Java.use('android.view.WindowManager$LayoutParams');

    set_flags.implementation = function(flags, mask){
        //console.log(Object.getOwnPropertyNames(window.__proto__).join('\n'));
        console.log("flag secure: " + layout_params.FLAG_SECURE.value);

        console.log("before setflags called  flags:  "+ flags);
        flags =(flags.value & ~layout_params.FLAG_SECURE.value);
        console.log("after setflags called  flags:  "+ flags);

        set_flags.call(this, flags, mask);
    };
});
```