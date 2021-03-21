/* eslint-disable prettier/prettier */
import * as Yup from 'yup';
import { startOfHour, parseISO, isBefore, format, subHours} from 'date-fns';
import pt from 'date-fns/locale/pt'
import User from '../models/User';
import File from '../models/File';
import Appointment from '../models/Appointment';
import Notification from '../schemas/Notification'
import CancellationMail from '../jobs/CancellationMail'

import Queue from '../../lib/Queue';

class AppointmentController {

  async index(req, res){
    const { page = 1 } = req.query;
    const appointments = await Appointment.findAll({
      where: { user_id: req.userId, canceled_at: null},
      order: ['date'],
      attributes: ['id', 'date', 'past', 'cancelable'],
      limit: 20,
      offset: (page - 1) * 20,
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['id', 'name'],
          include: [
            {
              model: File,
              as: 'avatar',
              attributes: ['id', 'path', 'url'],
            },
          ]

      }]
    });
    return res.json(appointments);
  }

  async store(req, res) {
    const schema = Yup.object().shape({
      provider_id: Yup.number().required(),
      date: Yup.date().required(),
    });

    if (!(await schema.isValid(req.body))) {
      return res.status(400).json({ error: 'Falha na validação!' });
    }
    const { provider_id, date } = req.body;
    /*
      Checar se provider_id é um prestador
    */
   const CheckIsProvider = await User.findOne({ where: {id: provider_id, provider: true},
  });
   if (!CheckIsProvider){
     return res
     .status(401)
     .json({error: 'Ops... Você não é um colaborador'});
   }
   /** checando se a hora desejada já passou */
   const hourStart = startOfHour(parseISO(date));

   if (isBefore(hourStart, new Date())){
     return res.status(400).json({error: 'Essa data não é permitida!'})
   }
   /**
		 * Check if provider_id is a provider
		 */

		const isProvider = await User.findOne({
			where: { id: provider_id, provider: true },
		});

		if (!isProvider) {
			return res
				.status(401)
				.json({ error: 'You can only create appointments with providers' });
		}

		if (req.userId === provider_id) {
			return res
				.status(401)
				.json({ error: `You can't create appointments with yourself` });
		}

   /** Checando se a data e hora está disponível */
   const checkAvailability = await Appointment.findOne({
     where: {
       provider_id,
       canceled_at: null,
       date: hourStart,
     },
   });

   if (checkAvailability){
    return res
    .status(400)
    .json({error: 'Agendamento não é válido. Data não permitida'});
  }

   const appointment = await Appointment.create({
     user_id: req.userId,
     provider_id,
     date: hourStart,
   });
   /**
    * Notificar prestador de serviço
    */
   const user = await User.findByPk(req.userId);
   const formattedDate = format(
     hourStart,
     "'dia' dd 'de' MMMM', às' H:mm'h'",
     { locale: pt }
   );
   await Notification.create({
     content: `Novo agendamento de ${user.name} para ${formattedDate}`,
     user: provider_id,
   });

   return res.json(appointment);
   }

  async delete(req, res) {
		const appointment = await Appointment.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['name', 'email'],
        },
        { model: User, as: 'user', attributes: ['name'], },
      ],
    });


		if (appointment.user_id !== req.userId) {
			return res.status(401).json({
				error: "You don't have permissoin to cancel this appointment",
			});
		}

		const dateWithSub = subHours(appointment.date, 2);

		if (isBefore(dateWithSub, new Date())) {
			res.status(401).json({
				error: 'You can only cancel appointments 2 hours in advance',
			});
		}

		appointment.canceled_at = new Date();

		await appointment.save();
    /**
     * envio de email notificando o cancelamento
     */
    await Queue.add(CancellationMail.key, {
      appointment,

    });

		return res.json(appointment);
	}
}

export default new AppointmentController();
