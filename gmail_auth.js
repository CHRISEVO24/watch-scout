const { google } = require('googleapis');
const http = require('http');
const url = require('url');

const oauth2Client = new google.auth.OAuth2(
  '897628627447-juumrdjbdu3a4v3badu2invsfgd1v1ka.apps.googleusercontent.com',
  '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',
  'http://localhost:3000/callback'
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/gmail.compose'],
  prompt: 'consent'
});

console.log('Opening browser for Google auth...');
require('child_process').exec('open "' + authUrl + '"');

const server = http.createServer(async (req, res) => {
  const code = url.parse(req.url, true).query.code;
  if (!code) return;
  res.end('Auth complete! You can close this tab.');
  server.close();
  const { tokens } = await oauth2Client.getToken(code);
  console.log('\nREFRESH TOKEN:', tokens.refresh_token);
  console.log('\nGMAIL_REFRESH_TOKEN=' + tokens.refresh_token);
});

server.listen(3000, () => console.log('Waiting for auth at http://localhost:3000...'));
