# Shortlink App

긴 URL을 짧은 링크로 만들고, 각 링크의 클릭 수를 확인할 수 있는 간단한 웹앱입니다.

## 실행 방법

```bash
cd /Users/thoamas-home/Documents/shortlink-app
node server.js
```

브라우저에서 `http://127.0.0.1:3000`에 접속하면 됩니다.

## Render 배포

1. GitHub 저장소에 프로젝트를 push합니다.
2. Render에서 `New Web Service`로 저장소를 연결합니다.
3. 아래 설정으로 배포합니다.
   - Start Command: `node server.js`
   - Plan: Free
4. 필요하면 환경변수 `BASE_URL`을 서비스 URL로 설정합니다.

앱은 `PORT` 환경변수를 사용하고 `0.0.0.0`에 바인딩되므로 Render에서 바로 동작합니다.

## 기능

- 긴 URL을 입력해 숏링크 생성
- 숏링크 접속 시 원본 URL로 리다이렉트
- 리다이렉트 발생 시 클릭 수 증가
- 생성된 링크 목록과 클릭 수 확인

## 데이터 저장

링크 데이터는 `data/links.json` 파일에 저장됩니다.
