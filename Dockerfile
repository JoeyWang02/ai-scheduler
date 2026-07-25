# ---- build stage ---------------------------------------------------------
# Builds the Spring Boot jar and bundles the static frontend into it, so a
# single service serves both the API and the web app (same origin, no CORS).
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build

# Dependencies first (better layer caching).
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

# App sources + the frontend, copied into the jar's static resources so Spring
# serves index.html / js / styles / images from the app root.
COPY src ./src
COPY frontend ./src/main/resources/static

RUN mvn -B -q -DskipTests clean package

# ---- run stage -----------------------------------------------------------
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /build/target/*.jar app.jar

# Railway/most PaaS inject $PORT; application.properties binds it.
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "app.jar"]
