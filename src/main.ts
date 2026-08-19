import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigurationService } from './configuration/configuration.service';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigurationService);
  const prefix = configService.apiPrefix.replace(/^\//, '');
  app.setGlobalPrefix(prefix, { exclude: ['metrics'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.enableCors();

  // Setup Swagger API Documentation dynamically from decorators
  const swaggerConfig = new DocumentBuilder()
    .setTitle('VDA Health Backend API')
    .setDescription('The API documentation for VDA Health Platform Core')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${prefix}/docs`, app, document);

  await app.listen(configService.port);
}
void bootstrap();
