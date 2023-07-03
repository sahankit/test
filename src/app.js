import { Logger } from '@hocuspocus/extension-logger'
import { Server } from '@hocuspocus/server'
import express from 'express'
import expressWebsockets from 'express-ws'
import { Database } from '@hocuspocus/extension-database'
import { Redis }  from '@hocuspocus/extension-redis'
//import { SQLite }  from '@hocuspocus/extension-sqlite'
import mongojs from 'mongojs';
import mongoist from 'mongoist';
import bodyParser from 'body-parser';

// const client = new MongoClient('mongodb://localhost:27017');
// const mongodb = client.db("test");

const mongojsDb = mongojs('mongodb+srv://test:5XlzdQBlII8QCknl@cluster0.v3nuvak.mongodb.net');
const db = mongoist(mongojsDb);

const server = Server.configure({
  extensions: [
    new Logger({
      log: (message) => {
        // do something custom here
        console.log("message",message);
      },
    }),
    new Redis({
      // [required] Hostname of your Redis instance
      host: 'redis://default:MFpJayEg40DGfT6yxKONkR4dKi8BrFVA@redis-13498.c283.us-east-1-4.ec2.cloud.redislabs.com',
      port: 13498
    }),
    // new SQLite({
    //   database: 'db.sqlite',
    // }),
  new Database({
    // Return a Promise to retrieve data …
    fetch: async ({ documentName }) => {
      return new Promise((resolve, reject) => {
        const query = { name: documentName };
     
       db['documents'].findOne(query).then((result)=>{
        //       console.log("found",query)
              resolve(result?.data?.buffer)
             }).catch((e)=>{
        reject(e)
             })

//      mongodb?.collection("documents")?.findOne(query).then((result)=>{
//       console.log("found",query)
//       resolve(result?.data)
//      }).catch((e)=>{
// reject(e)
//      })
  
      });
    },
    // … and a Promise to store data:
    store: async (a) => {
      const {state,documentName,update}=a;
      const query = { name: documentName };
      const values = {data:state, date: Date.now()}
     await db['documents'].findAndModify({
        query,
        update: { ...query, ...values },
        upsert: true,
        new: true,
      });

      console.log("update",query)
    },
  }),

  ],
})

const { app } = expressWebsockets(express())

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});
app.get('/', (request, response) => {
  response.send('Hello World!')
})
app.post('/version/:documentName', bodyParser.json(),async (request, response) => {
  const a = request.body
  const {clientID,snapshot,date,projectId}=a;
  const query = { projectId: projectId };
  const values = a;
  await db['documentVersion'].findAndModify({
    query,
    update: { ...query, ...values },
    upsert: true,
    new: true,
  });
  response.send();
})
app.ws('/:documentName', (websocket, request) => {
  const context = { user_id: 1234 }
  server.handleConnection(websocket, request, context)
})

app.listen(1234, () => console.log('Listening on http://127.0.0.1:1234…'))