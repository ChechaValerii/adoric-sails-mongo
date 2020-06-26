const machine = require('machine');

const createManager = machine.build(require('../..').createManager);
const getConnection = machine.build(require('../..').getConnection);
const releaseConnection = machine.build(require('../..').releaseConnection);

describe('Connectable ::', () => {
    describe('Release Connection', () => {
        let manager;
        let connection;

        // Create a manager and connection
        before((done) => {
            // Needed to dynamically get the host using the docker container
            const host = process.env.WATERLINE_ADAPTER_TESTS_HOST || 'localhost';

            createManager({
                connectionString: `mongodb://${host}:27017/mppg`,
            })
                .exec((err, report) => {
                    if (err) {
                        return done(err);
                    }

                    manager = report.manager;

                    getConnection({
                        manager,
                    })
                        .exec((error, rep) => {
                            if (error) {
                                return done(error);
                            }

                            connection = rep.connection;
                            return done();
                        });
                });
        });

        // The actual machine is a no-op so just ensure no error comes back.
        it('should successfully release a connection', (done) => {
            releaseConnection({
                connection,
            })
                .exec((err) => {
                    if (err) {
                        return done(err);
                    }

                    return done();
                });
        });
    });
});
